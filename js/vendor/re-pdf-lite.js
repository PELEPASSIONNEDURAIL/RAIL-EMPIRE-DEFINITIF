/* Rail Empire local PDF runtime.
 * Small jsPDF-compatible subset used by RC30 reporting pages.
 * Offline-first: no network dependency, no dynamic imports.
 */
(function(root){
  'use strict';
  if(root.jspdf&&root.jspdf.jsPDF)return;
  var MM=72/25.4, PAGE_W=210, PAGE_H=297;
  function ascii(value){
    var s=String(value==null?'':value);
    try{s=s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}catch(_e){}
    return s.replace(/€/g,' EUR').replace(/[–—]/g,'-').replace(/’/g,"'").replace(/[^\x20-\x7E]/g,'?');
  }
  function escPdf(s){return ascii(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');}
  function finite(n,fallback){n=Number(n);return Number.isFinite(n)?n:fallback;}
  function num(n){n=finite(n,0);var rounded=Math.round(n*1000)/1000;return Number.isFinite(rounded)?rounded:n;}
  function rgb(args){
    if(args.length>=3)return [finite(args[0],0)/255,finite(args[1],0)/255,finite(args[2],0)/255];
    var g=finite(args[0],0)/255;return[g,g,g];
  }
  function fontKey(style){style=String(style||'normal').toLowerCase();if(style.indexOf('bold')>=0&&style.indexOf('italic')>=0)return'F4';if(style.indexOf('bold')>=0)return'F2';if(style.indexOf('italic')>=0)return'F3';return'F1';}
  function LitePDF(){
    if(!(this instanceof LitePDF))return new LitePDF();
    this._pages=[[]];this._pageImages=[[]];this._images=[];this._pendingImages=[];this._imageErrors=[];this._page=0;this._fontSize=12;this._font='F1';this._text=[0,0,0];this._draw=[0,0,0];this._fill=[0,0,0];
    this.internal={pageSize:{getWidth:function(){return PAGE_W;},getHeight:function(){return PAGE_H;}}};
  }
  LitePDF.prototype._push=function(cmd){this._pages[this._page].push(cmd);return this;};
  LitePDF.prototype.setFontSize=function(v){this._fontSize=Math.max(1,finite(v,12)||12);return this;};
  LitePDF.prototype.setFont=function(_name,style){this._font=fontKey(style);return this;};
  LitePDF.prototype.setTextColor=function(){this._text=rgb(arguments);return this;};
  LitePDF.prototype.setDrawColor=function(){this._draw=rgb(arguments);return this;};
  LitePDF.prototype.setFillColor=function(){this._fill=rgb(arguments);return this;};
  LitePDF.prototype.setLineDash=function(pattern,phase){pattern=Array.isArray(pattern)?pattern:[];var p=pattern.map(function(v){return num(Number(v)*MM);}).join(' ');return this._push('['+p+'] '+num(Number(phase||0)*MM)+' d');};
  LitePDF.prototype.getTextWidth=function(value){return ascii(value).length*this._fontSize*0.50/MM;};
  LitePDF.prototype.splitTextToSize=function(value,maxWidth){
    var text=ascii(value),words=text.split(/\s+/),lines=[],line='';maxWidth=Math.max(1,Number(maxWidth)||1);
    for(var i=0;i<words.length;i++){
      var candidate=line?line+' '+words[i]:words[i];
      if(line&&this.getTextWidth(candidate)>maxWidth){lines.push(line);line=words[i];}
      else line=candidate;
    }
    if(line)lines.push(line);return lines.length?lines:[''];
  };
  LitePDF.prototype.text=function(value,x,y,options){
    var lines=Array.isArray(value)?value:[value],opts=options||{},fs=this._fontSize,lh=fs*1.2;
    for(var i=0;i<lines.length;i++){
      var line=ascii(lines[i]),xp=Number(x||0)*MM,yp=(PAGE_H-Number(y||0))*MM-i*lh;
      if(opts.align==='center')xp-=this.getTextWidth(line)*MM/2;else if(opts.align==='right')xp-=this.getTextWidth(line)*MM;
      var c=this._text;
      this._push('BT /'+this._font+' '+num(fs)+' Tf '+num(c[0])+' '+num(c[1])+' '+num(c[2])+' rg 1 0 0 1 '+num(xp)+' '+num(yp)+' Tm ('+escPdf(line)+') Tj ET');
    }
    return this;
  };
  LitePDF.prototype.line=function(x1,y1,x2,y2){var c=this._draw;return this._push(num(c[0])+' '+num(c[1])+' '+num(c[2])+' RG '+num(Number(x1)*MM)+' '+num((PAGE_H-Number(y1))*MM)+' m '+num(Number(x2)*MM)+' '+num((PAGE_H-Number(y2))*MM)+' l S');};
  LitePDF.prototype.rect=function(x,y,w,h,style){var f=this._fill,d=this._draw,op=String(style||'S').toUpperCase()==='F'?'f':'S';return this._push(num(f[0])+' '+num(f[1])+' '+num(f[2])+' rg '+num(d[0])+' '+num(d[1])+' '+num(d[2])+' RG '+num(Number(x)*MM)+' '+num((PAGE_H-Number(y)-Number(h))*MM)+' '+num(Number(w)*MM)+' '+num(Number(h)*MM)+' re '+op);};
  function binary(bytes){var parts=[],part='';for(var i=0;i<bytes.length;i++){part+=String.fromCharCode(bytes[i]);if(part.length===8192){parts.push(part);part='';}}if(part)parts.push(part);return parts.join('');}
  function jpegComponents(body){
    var i=2;while(i<body.length){if(body.charCodeAt(i++)!==255)continue;while(body.charCodeAt(i)===255)i++;var marker=body.charCodeAt(i++);
      if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=216)continue;
      var length=body.charCodeAt(i)*256+body.charCodeAt(i+1);if(length<2||i+length>body.length)break;
      if(marker>=192&&marker<=207&&marker!==196&&marker!==200&&marker!==204)return body.charCodeAt(i+7);i+=length;
    }return 0;
  }
  LitePDF.prototype.addImage=function(value,_format,x,y,w,h){
    var source=typeof value==='string'?value:value&&typeof value.toDataURL==='function'?value.toDataURL('image/png'):value&&value.src;
    if(typeof source!=='string'||!/^data:image\/[^;,]+(?:;[^,]*)?,/i.test(source))throw new TypeError('Image PDF locale requise.');
    x=finite(x,0);y=finite(y,0);w=finite(w,0);h=finite(h,0);if(w<=0||h<=0)throw new TypeError('Dimensions image PDF invalides.');
    if(typeof root.Image!=='function'||typeof document==='undefined')throw new Error('Décodeur image PDF indisponible.');
    var doc=this,id=this._images.length+1;this._images.push(null);this._pageImages[this._page].push(id);
    this._push('q '+num(w*MM)+' 0 0 '+num(h*MM)+' '+num(x*MM)+' '+num((PAGE_H-y-h)*MM)+' cm /Im'+id+' Do Q');
    var pending=new Promise(function(resolve){
      var img=new root.Image();
      function failed(error){doc._imageErrors.push(error);img.onload=null;img.onerror=null;resolve();}
      img.onerror=function(){failed(new Error('Image PDF locale indécodable.'));};
      img.onload=function(){try{
        var width=Number(img.naturalWidth||img.width),height=Number(img.naturalHeight||img.height);
        if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0)throw new Error('Image PDF vide.');
        var image={width:width,height:height,body:'',jpeg:false,alpha:null};
        var jpeg=/^data:image\/jpe?g;(?:[^,]*;)?base64,/i.test(source)?root.atob(source.slice(source.indexOf(',')+1)):null;
        if(jpeg!==null&&jpegComponents(jpeg)===3){
          image.body=jpeg;image.jpeg=true;
        }else{
          var canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;var ctx=canvas.getContext('2d');
          if(!ctx)throw new Error('Décodeur canvas PDF indisponible.');ctx.drawImage(img,0,0);
          var rgba=ctx.getImageData(0,0,width,height).data,rgbBytes=new Uint8Array(width*height*3),alpha=new Uint8Array(width*height),transparent=false;
          for(var pixel=0;pixel<alpha.length;pixel++){rgbBytes[pixel*3]=rgba[pixel*4];rgbBytes[pixel*3+1]=rgba[pixel*4+1];rgbBytes[pixel*3+2]=rgba[pixel*4+2];alpha[pixel]=rgba[pixel*4+3];if(alpha[pixel]!==255)transparent=true;}
          image.body=binary(rgbBytes);if(transparent)image.alpha=binary(alpha);canvas.width=0;canvas.height=0;
        }
        doc._images[id-1]=image;img.onload=null;img.onerror=null;resolve();
      }catch(error){failed(error);}};
      try{img.src=source;}catch(error){failed(error);}
    });this._pendingImages.push(pending);return this;
  };
  LitePDF.prototype.ready=function(){var doc=this;return Promise.all(this._pendingImages).then(function(){if(doc._imageErrors.length)throw doc._imageErrors[0];return doc;});};
  LitePDF.prototype.addPage=function(){this._pages.push([]);this._pageImages.push([]);this._page=this._pages.length-1;return this;};
  LitePDF.prototype._build=function(){
    if(this._imageErrors.length)throw this._imageErrors[0];if(this._images.some(function(image){return !image;}))throw new Error('Image PDF en cours : attendre doc.ready() ou doc.save().');
    var objs=[null],fontIds={},imageIds={};
    function add(s){objs.push(String(s));return objs.length-1;}
    fontIds.F1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    fontIds.F2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    fontIds.F3=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>');
    fontIds.F4=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>');
    function stream(dictionary,body){return add('<< '+dictionary+' /Length '+body.length+' >>\nstream\n'+body+'\nendstream');}
    for(var im=0;im<this._images.length;im++){
      var image=this._images[im],mask=image.alpha==null?0:stream('/Type /XObject /Subtype /Image /Width '+image.width+' /Height '+image.height+' /ColorSpace /DeviceGray /BitsPerComponent 8',image.alpha);
      imageIds[im+1]=stream('/Type /XObject /Subtype /Image /Width '+image.width+' /Height '+image.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8'+(image.jpeg?' /Filter /DCTDecode':'')+(mask?' /SMask '+mask+' 0 R':''),image.body);
    }
    var pageRefs=[],contents=[];
    for(var i=0;i<this._pages.length;i++){var body=this._pages[i].join('\n');contents.push(add('<< /Length '+body.length+' >>\nstream\n'+body+'\nendstream'));pageRefs.push(0);}
    var pagesId=add('PAGES_PLACEHOLDER');
    for(var j=0;j<this._pages.length;j++){
      var images=this._pageImages[j]||[],resources='<< /Font << /F1 '+fontIds.F1+' 0 R /F2 '+fontIds.F2+' 0 R /F3 '+fontIds.F3+' 0 R /F4 '+fontIds.F4+' 0 R >>'+(images.length?' /XObject << '+images.map(function(id){return '/Im'+id+' '+imageIds[id]+' 0 R';}).join(' ')+' >>':'')+' >>';
      pageRefs[j]=add('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+num(PAGE_W*MM)+' '+num(PAGE_H*MM)+'] /Resources '+resources+' /Contents '+contents[j]+' 0 R >>');
    }
    objs[pagesId]='<< /Type /Pages /Count '+pageRefs.length+' /Kids ['+pageRefs.map(function(id){return id+' 0 R';}).join(' ')+'] >>';
    var catalogId=add('<< /Type /Catalog /Pages '+pagesId+' 0 R >>');
    var out='%PDF-1.4\n%RailEmpire\n',offsets=[0];
    for(var k=1;k<objs.length;k++){offsets[k]=out.length;out+=k+' 0 obj\n'+objs[k]+'\nendobj\n';}
    var xref=out.length;out+='xref\n0 '+objs.length+'\n0000000000 65535 f \n';
    for(var q=1;q<objs.length;q++)out+=String(offsets[q]).padStart(10,'0')+' 00000 n \n';
    out+='trailer\n<< /Size '+objs.length+' /Root '+catalogId+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';return out;
  };
  LitePDF.prototype.output=function(kind){var s=this._build();if(kind==='arraybuffer'){var b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i)&255;return b.buffer;}return s;};
  LitePDF.prototype.save=function(filename){
    if(this._images.length){var doc=this;return this.ready().then(function(){return doc._saveReady(filename);});}
    return this._saveReady(filename);
  };
  LitePDF.prototype._saveReady=function(filename){
    var s=this._build(),bytes=new Uint8Array(s.length);for(var i=0;i<s.length;i++)bytes[i]=s.charCodeAt(i)&255;
    if(typeof document==='undefined'||typeof Blob==='undefined')return bytes;
    var blob=new Blob([bytes],{type:'application/pdf'}),url=(root.URL||root.webkitURL).createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=String(filename||'rail-empire.pdf');a.style.display='none';document.body.appendChild(a);a.click();setTimeout(function(){try{a.remove();(root.URL||root.webkitURL).revokeObjectURL(url);}catch(_e){}},0);return this;
  };
  root.jspdf={jsPDF:LitePDF};
})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));
