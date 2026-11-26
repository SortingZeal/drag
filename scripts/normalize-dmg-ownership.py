#!/usr/bin/env python3
"""Remove build-host owner IDs from a writable HFS+ release image.

The image is created as UDRW, so its partition bytes are directly addressable.
The build host owner IDs and its provenance attributes are removed.
The resulting image must be converted to a compressed DMG and verified before
release. Unknown (99) is the portable owner/group for shared macOS volumes.
"""

import json
import os
from pathlib import Path
import struct
import sys


UNKNOWN_ID = 99
SYSTEM_OWNER = (0, 0)


def read_at(stream, offset, length):
    stream.seek(offset)
    value = stream.read(length)
    if len(value) != length:
        raise ValueError("HFS+ image is truncated")
    return value


def volume_header(stream, image_size):
    candidates = []
    for volume_start in range(0, min(image_size - 1536, 1024 * 1024), 512):
        header = read_at(stream, volume_start + 1024, 512)
        if header[:2] not in (b"H+", b"HX"):
            continue
        version = struct.unpack_from(">H", header, 2)[0]
        block_size = struct.unpack_from(">I", header, 40)[0]
        catalog_size = struct.unpack_from(">Q", header, 272)[0]
        if version in (4, 5) and 512 <= block_size <= 65536 and block_size & (block_size - 1) == 0 and catalog_size:
            candidates.append((volume_start, header, block_size, catalog_size))
    if len(candidates) != 1:
        raise ValueError(f"Expected one HFS+ volume, found {len(candidates)}")
    return candidates[0]


def fork_reader(stream, image_size, volume_start, header, block_size, catalog_size, fork_offset):
    extents = []
    logical_start = 0
    for index in range(8):
        start_block, block_count = struct.unpack_from(">II", header, fork_offset + 16 + index * 8)
        if not block_count:
            continue
        physical_start = volume_start + start_block * block_size
        byte_count = block_count * block_size
        if physical_start + byte_count > image_size:
            raise ValueError("Catalog extent exceeds image size")
        extents.append((logical_start, logical_start + byte_count, physical_start))
        logical_start += byte_count
    if logical_start < catalog_size:
        raise ValueError("Catalog needs an unsupported overflow extent")

    def read_catalog(offset, length):
        if offset < 0 or length < 0 or offset + length > catalog_size:
            raise ValueError("Catalog read exceeds its logical size")
        for start, end, physical in extents:
            if start <= offset and offset + length <= end:
                return read_at(stream, physical + offset - start, length), physical + offset - start
        raise ValueError("Catalog node crosses an extent boundary")

    return read_catalog


def catalog_owners(stream, image_size, cleared=()):
    volume_start, header, block_size, catalog_size = volume_header(stream, image_size)
    read_catalog = fork_reader(stream, image_size, volume_start, header, block_size, catalog_size, 272)
    tree_header, _ = read_catalog(0, 512)
    first_leaf = struct.unpack_from(">I", tree_header, 24)[0]
    node_size = struct.unpack_from(">H", tree_header, 32)[0]
    if not 512 <= node_size <= 32768 or node_size & (node_size - 1):
        raise ValueError("Invalid HFS+ catalog node size")

    seen = set()
    changes = []
    preserved_system = 0
    records = 0
    leaf = first_leaf
    while leaf:
        if leaf in seen:
            raise ValueError("HFS+ catalog leaf cycle")
        seen.add(leaf)
        node, physical = read_catalog(leaf * node_size, node_size)
        if struct.unpack_from(">b", node, 8)[0] != -1:
            raise ValueError("HFS+ catalog leaf has invalid kind")
        count = struct.unpack_from(">H", node, 10)[0]
        if count < 1 or count > node_size // 2 - 1:
            raise ValueError("HFS+ catalog leaf record count is invalid")
        record_limit = node_size - 2 * (count + 1)
        for index in range(count):
            offset = struct.unpack_from(">H", node, node_size - 2 * (index + 1))[0]
            if offset + 2 > record_limit:
                raise ValueError("HFS+ catalog record offset is invalid")
            key_length = struct.unpack_from(">H", node, offset)[0]
            data_offset = offset + 2 + key_length
            if data_offset + 2 > record_limit:
                raise ValueError("HFS+ catalog record is truncated")
            record_type = struct.unpack_from(">H", node, data_offset)[0]
            if record_type not in (1, 2):
                continue
            if data_offset + 40 > record_limit:
                raise ValueError("HFS+ catalog folder/file record is truncated")
            if struct.unpack_from(">I", node, data_offset + 8)[0] in cleared:
                flags = struct.unpack_from(">H", node, data_offset + 2)[0]
                stream.seek(physical + data_offset + 2)
                stream.write(struct.pack(">H", flags & ~0x0004))  # kHFSHasAttributesMask
            records += 1
            owner_offset = data_offset + 32
            owner = struct.unpack_from(">II", node, owner_offset)
            if owner == SYSTEM_OWNER:
                preserved_system += 1
            elif owner != (UNKNOWN_ID, UNKNOWN_ID):
                changes.append(physical + owner_offset)
        leaf = struct.unpack_from(">I", node, 0)[0]
    if not records:
        raise ValueError("HFS+ catalog has no folder/file records")
    return changes, records, preserved_system, len(seen)


def node_offsets(node):
    count = struct.unpack_from(">H", node, 10)[0]
    offsets = [struct.unpack_from(">H", node, len(node) - 2*i)[0] for i in range(1, count + 2)]
    if offsets[0] != 14 or sorted(set(offsets)) != offsets or offsets[-1] > len(node) - 2*len(offsets):
        raise ValueError("Invalid HFS+ attribute node records")
    return offsets


def pack_node(size, records, kind, height, previous=0, following=0):
    node = bytearray(size)
    struct.pack_into(">IIbBH", node, 0, following, previous, kind, height, len(records))
    offset = 14
    for index, record in enumerate([*records, b'']):
        if offset + len(record) > size - 2*(len(records) + 1):
            raise ValueError("HFS+ attribute node capacity exceeded")
        struct.pack_into(">H", node, size - 2*(index + 1), offset)
        node[offset:offset + len(record)] = record
        offset += len(record)
    return node


def remove_provenance(stream, image_size):
    # hdiutil lays out this fixed release as one attribute index above leaf nodes.
    # Preserve the remaining record bytes and node IDs. Reject unsupported layouts.
    start, volume, block, _ = volume_header(stream, image_size)
    length = struct.unpack_from(">Q", volume, 352)[0]
    if not length:
        return set(), 0
    read = fork_reader(stream, image_size, start, volume, block, length, 352)
    prefix, _ = read(0, 512)
    depth, root, count, first, last, size, _, total, free = struct.unpack_from(">HIIIIHHII", prefix, 14)
    if depth == 0 and count == 0:
        return set(), 0
    if depth not in (1, 2) or not 512 <= size <= 32768 or size & (size - 1):
        raise ValueError("Unsupported HFS+ attribute tree geometry")
    header, header_pos = read(0, size)
    header = bytearray(header)
    offsets = node_offsets(header)
    if len(offsets) != 4 or total > (offsets[3] - offsets[2])*8 or struct.unpack_from(">I", header)[0]:
        raise ValueError("Unsupported HFS+ attribute tree node map")
    leaves = []
    leaf, seen = first, set()
    retained_ids, removed_ids, discarded_payloads = set(), set(), set()
    sum_records = removed = 0
    while leaf:
        if leaf in seen or leaf >= total:
            raise ValueError("Invalid HFS+ attribute leaf chain")
        seen.add(leaf)
        node, position = read(leaf*size, size)
        if struct.unpack_from(">b", node, 8)[0] != -1:
            raise ValueError("Invalid attribute leaf kind")
        offsets_in_node = node_offsets(node)
        retained = []
        for left, right in zip(offsets_in_node, offsets_in_node[1:]):
            record = node[left:right]
            key_length, _, file_id, _, characters = struct.unpack_from(">HHIIH", record)
            if key_length != 12 + 2*characters or 2 + key_length > len(record):
                raise ValueError("Invalid HFS+ attribute key")
            name = record[14:2+key_length].decode("utf-16-be")
            sum_records += 1
            if name != "com.apple.provenance":
                retained_ids.add(file_id)
                retained.append(record)
                continue
            data = record[2+key_length:]
            if len(data) < 16 or struct.unpack_from(">I", data)[0] != 0x10:
                raise ValueError("Expected inline build provenance")
            attr_size = struct.unpack_from(">I", data, 12)[0]
            if not attr_size or attr_size > len(data)-16:
                raise ValueError("Invalid build provenance length")
            discarded_payloads.add(data[16:16+attr_size])
            removed_ids.add(file_id)
            removed += 1
        leaves.append((leaf, position, retained))
        leaf = struct.unpack_from(">I", node)[0]
    if sum_records != count or leaves[-1][0] != last:
        raise ValueError("Attribute tree inventory mismatch")
    if not removed:
        return set(), 0
    live = [entry for entry in leaves if entry[2]]
    next_free = []
    updates = {}
    root_records = []
    for index, (node_id, position, records) in enumerate(live):
        prev = live[index-1][0] if index else 0
        following = live[index+1][0] if index+1 < len(live) else 0
        updates[position] = pack_node(size, records, -1, 1, prev, following)
        key_end = 2 + struct.unpack_from(">H", records[0])[0]
        root_records.append(records[0][:key_end] + struct.pack(">I", node_id))
    for node_id, position, records in leaves:
        if not records:
            updates[position] = bytes(size)
            next_free.append(node_id)
    if depth == 2:
        index_node, position = read(root*size, size)
        if struct.unpack_from(">b", index_node, 8)[0] != 0:
            raise ValueError("Expected single HFS+ attribute index")
        if len(live) > 1:
            updates[position] = pack_node(size, root_records, 0, 2)
        else:
            updates[position] = bytes(size)
            next_free.append(root)
    new_depth = 2 if len(live) > 1 else len(live)
    new_root = root if new_depth == 2 else (live[0][0] if live else 0)
    struct.pack_into(">HIIII", header, 14, new_depth, new_root, count-removed,
                     live[0][0] if live else 0, live[-1][0] if live else 0)
    for node_id in next_free:
        header[offsets[2] + node_id//8] &= ~(1 << (7 - node_id%8))
    struct.pack_into(">I", header, 40, free + len(next_free))
    updates[header_pos] = header
    for position, data in updates.items():
        stream.seek(position)
        stream.write(data)
    # A raw release must not retain a second copy in slack space or a journal.
    import mmap
    with mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as image:
        if any(len(value) >= 8 and image.find(value) >= 0 for value in discarded_payloads):
            raise ValueError("Disk image retains build provenance outside live attributes")
    return removed_ids - retained_ids, removed


def main(image):
    path = Path(image)
    size = path.stat().st_size
    with path.open("r+b", buffering=0) as stream:
        cleared, removed = remove_provenance(stream, size)
        changes, records, system, leaves = catalog_owners(stream, size, cleared)
        for offset in changes:
            stream.seek(offset)
            stream.write(struct.pack(">II", UNKNOWN_ID, UNKNOWN_ID))
        stream.flush()
        os.fsync(stream.fileno())
        remaining, verified_records, verified_system, verified_leaves = catalog_owners(stream, size)
    if remaining or verified_records != records or verified_system != system or verified_leaves != leaves:
        raise ValueError("HFS+ ownership normalization did not verify")
    print(json.dumps({"removedProvenance": removed, "records": records, "normalized": len(changes), "systemRecords": system, "leafNodes": leaves, "owner": UNKNOWN_ID, "group": UNKNOWN_ID}))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: normalize-dmg-ownership.py <writable-UDRW-image>")
    main(sys.argv[1])
