const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

test('hoisted weapon ray preserves the effect at the original iteration counts', async ({ page }) => {
  const source = fs.readFileSync('src/three_fps_game.ts', 'utf8');
  const skin = source.slice(source.indexOf('const weaponSkinMaterial ='));
  const optimized = skin.match(/fragmentShader: \/\* glsl \*\/`([\s\S]*?)`/)[1];
  expect(optimized).toContain('i<43.');
  expect(optimized).toContain('j<10');
  const original = optimized.replace(/        vec3 ray =[^;]+;\s*ray.xy\*=c\(r\);\s*ray.yz\*=c\(q\);\s*ray.xz\*=c\(p\);/, '').replace('          vec3 a=ray*d;', `
          vec3 a=vec3((n.xy*2.1-g)/g.y*d,d);
          a.xy*=c(r);
          a.yz*=c(q);
          a.xz*=c(p);`);
  const result = await page.evaluate(({ original, optimized }) => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144;
    const gl = canvas.getContext('webgl', { antialias: false });
    const compile = (type, text) => { const s=gl.createShader(type); gl.shaderSource(s,text); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const make = fragment => {
      const p = gl.createProgram();
      gl.attachShader(p,compile(gl.VERTEX_SHADER,'attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}'));
      gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fragment)); gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)); return p;
    };
    const programs = [make(original), make(optimized)];
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const pixels = [new Uint8Array(canvas.width*canvas.height*4),new Uint8Array(canvas.width*canvas.height*4)];
    const timings = [[],[]], comparisons=[];
    function draw(index,time) {
      const p=programs[index]; gl.useProgram(p); const loc=gl.getAttribLocation(p,'position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      gl.uniform2f(gl.getUniformLocation(p,'iResolution'),canvas.width,canvas.height); gl.uniform1f(gl.getUniformLocation(p,'uTime'),time);
      const start=performance.now(); gl.drawArrays(gl.TRIANGLES,0,3); gl.finish();
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels[index]);
      timings[index].push(performance.now()-start);
    }
    for(const time of [0,.5,3,12,40,90]) {
      draw(0,time);draw(1,time);
      let sum=0,max=0,changed=0;
      for(let i=0;i<pixels[0].length;i++) { const d=Math.abs(pixels[0][i]-pixels[1][i]);sum+=d;max=Math.max(max,d);if(d>8)changed++; }
      comparisons.push({time,mean:sum/pixels[0].length,max,changedFraction:changed/pixels[0].length});
    }
    return {timings,comparisons};
  }, {original,optimized});
  console.log(JSON.stringify(result));
  for(const comparison of result.comparisons) {
    expect(comparison.mean).toBeLessThan(.5);
    expect(comparison.changedFraction).toBeLessThan(.01);
  }
});
