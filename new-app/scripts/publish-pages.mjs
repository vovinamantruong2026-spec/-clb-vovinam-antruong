import {readFile,writeFile,cp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(app,'..');
const canonical='https://vovinamantruong2026-spec.github.io/';
// Keep module URLs relative to their actual /v2/assets location for lazy imports.
const html=await readFile(resolve(app,'dist/index.html'),'utf8');
await mkdir(resolve(root,'v2'),{recursive:true});
await cp(resolve(app,'dist'),resolve(root,'v2'),{recursive:true});
const entry=html.replaceAll('"./assets/','"./v2/assets/').replace('</head>','<meta name="robots" content="noindex"/><link rel="canonical" href="'+canonical+'"/></head>');
await writeFile(resolve(root,'index.html'),entry);
await cp(resolve(app,'public/favicon.svg'),resolve(root,'favicon.svg'));
await writeFile(resolve(root,'.nojekyll'),'');
function redirect(target){return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url='+target+'"><link rel="canonical" href="'+canonical+'"><title>Vovinam An Trường</title><script>location.replace('+JSON.stringify(target)+')</script></head><body><a href="'+target+'">Mở trang quản lý CLB</a></body></html>\n'}
await writeFile(resolve(root,'dang-nhap.html'),redirect('./'));
// Original project URLs become paths on the user site after repository rename.
for(const path of ['-clb-vovinam-antruong/index.html','-clb-vovinam-antruong/v2/index.html','-clb-vovinam-antruong/dang-nhap.html']){await mkdir(dirname(resolve(root,path)),{recursive:true});await writeFile(resolve(root,path),redirect(canonical));}
console.log('Published app at repository root; retained /v2/ and old project-link entry points.');
