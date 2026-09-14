/* 生成网球记 PWA 图标，纯 Node，无外部依赖 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/* ---- CRC32 ---- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba /*Buffer*/) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0; // 8-bit RGBA
  const stride = width*4;
  const raw = Buffer.alloc((stride+1)*height);
  for (let y=0;y<height;y++){
    raw[y*(stride+1)] = 0; // filter: none
    rgba.copy(raw, y*(stride+1)+1, y*stride, y*stride+stride);
  }
  const idat = zlib.deflateSync(raw, {level:9});
  return Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]);
}

/* ---- drawing ---- */
function setPx(rgba,w,x,y,r,g,b,a){
  if(x<0||y<0||x>=w||y>=w) return;
  const i=(y*w+x)*4; rgba[i]=r; rgba[i+1]=g; rgba[i+2]=b; rgba[i+3]=a;
}
function inRoundedSquare(x,y,s,r){
  const inLeft = x < r, inRight = x > s-1-r;
  const inTop = y < r, inBottom = y > s-1-r;
  if((inLeft||inRight) && (inTop||inBottom)){
    const nx = inLeft ? r : s-1-r;
    const ny = inTop ? r : s-1-r;
    return (x-nx)*(x-nx)+(y-ny)*(y-ny) <= r*r;
  }
  return true;
}
function stampDisk(rgba,w,cx,cy,rad,color,ballR,bcx,bcy){
  const r2=rad*rad;
  const x0=Math.max(0,Math.floor(cx-rad)), x1=Math.min(w-1,Math.ceil(cx+rad));
  const y0=Math.max(0,Math.floor(cy-rad)), y1=Math.min(w-1,Math.ceil(cy+rad));
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const dx=x-cx, dy=y-cy;
    if(dx*dx+dy*dy<=r2){
      const bx=x-bcx, by=y-bcy;
      if(bx*bx+by*by <= ballR*ballR) setPx(rgba,w,x,y,color[0],color[1],color[2],255);
    }
  }
}
function drawIcon(size, maskable){
  const w=size, h=size;
  const rgba = Buffer.alloc(w*h*4);
  const cx=w/2, cy=h/2;
  const bg=[46,125,50];      // tennis green
  const ball=[201,255,70];   // ball yellow-green
  const seam=[255,255,255];  // white seam
  const ballR = maskable ? size*0.30 : size*0.332;
  const cornerR = size*0.18;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const inBg = maskable ? true : inRoundedSquare(x,y,size,cornerR);
    if(inBg) setPx(rgba,w,x,y,bg[0],bg[1],bg[2],255);
    // ball
    const dx=x-cx, dy=y-cy;
    if(dx*dx+dy*dy <= ballR*ballR) setPx(rgba,w,x,y,ball[0],ball[1],ball[2],255);
  }
  // seam: two crossing cubic Bézier S-curves (tennis ball look)
  const s = size/512;
  const P0=[256*s,86*s], P3=[256*s,426*s];
  const curves=[ [[376*s,156*s],[136*s,356*s]], [[136*s,156*s],[376*s,356*s]] ];
  const thick = 16*s;
  for(const [P1,P2] of curves){
    for(let t=0;t<=1;t+=0.004){
      const u=1-t;
      const x=u*u*u*P0[0]+3*u*u*t*P1[0]+3*u*t*t*P2[0]+t*t*t*P3[0];
      const y=u*u*u*P0[1]+3*u*u*t*P1[1]+3*u*t*t*P2[1]+t*t*t*P3[1];
      stampDisk(rgba,w,x,y,thick,seam,ballR,cx,cy);
    }
  }
  return encodePNG(w,h,rgba);
}

const dir = path.join(__dirname,'icons');
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'icon-512.png'), drawIcon(512,false));
fs.writeFileSync(path.join(dir,'icon-192.png'), drawIcon(192,false));
fs.writeFileSync(path.join(dir,'icon-maskable-512.png'), drawIcon(512,true));
fs.writeFileSync(path.join(dir,'apple-touch-icon.png'), drawIcon(180,false));
fs.writeFileSync(path.join(dir,'favicon-32.png'), drawIcon(32,false));
console.log('icons generated in', dir);
