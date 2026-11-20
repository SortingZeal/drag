// AppleDouble companions for ZIP restore signing metadata on non-Mach-O resources.
#include <copyfile.h>
#include <stdio.h>
#include <string.h>

static int package_attribute(int what, int stage, copyfile_state_t state,
                             const char *source, const char *destination, void *context) {
    if (what != COPYFILE_COPY_XATTR || stage != COPYFILE_START) return COPYFILE_CONTINUE;
    const char *name = NULL;
    if (copyfile_state_get(state, COPYFILE_STATE_XATTRNAME, &name) || !name) return COPYFILE_QUIT;
    if (strncmp(name, "com.apple.cs.", 13) == 0 ||
        strcmp(name, "com.apple.ResourceFork") == 0 ||
        strcmp(name, "com.apple.FinderInfo") == 0) return COPYFILE_CONTINUE;
    return COPYFILE_SKIP;
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    copyfile_state_t state = copyfile_state_alloc();
    if (!state) return 1;
    int status = copyfile_state_set(state, COPYFILE_STATE_STATUS_CB, (void *)package_attribute);
    if (!status) status = copyfile(argv[1], argv[2], state,
                                   COPYFILE_PACK | COPYFILE_XATTR | COPYFILE_NOFOLLOW);
    if (status) perror("Packing Mac file attributes");
    copyfile_state_free(state);
    return status != 0;
}
