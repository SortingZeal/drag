import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentFilename} from '../src/documents.js';

test('document filenames preserve Unicode and sanitize unsupported OS names',()=>{
 for(const [input,expected] of [
  ['我的時程','我的時程.json'],['草稿.JSON','草稿.json'],['a/b:c*?"<>|','a-b-c------.json'],
  ['', '時間軸.json'],['...','時間軸.json'],['CON','drag-CON.json'],['LPT1.txt','drag-LPT1.txt.json'],
  ['正常.  ','正常.json'],['任務\u0000檔案','任務-檔案.json'],['console','console.json'],
 ])assert.equal(documentFilename(input),expected);
 assert.ok(documentFilename('長'.repeat(300)).length<=205);
});
