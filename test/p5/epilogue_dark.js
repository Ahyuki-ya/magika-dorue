(function(){
  function rates(depth, mode){
    gameMode=mode; if(typeof shopData==='object') shopData.wraith=true; maxDepth=0;
    const y=SKY_LAYERS+1+depth; const N=300000; let dark=0,gem=0,cop=0,moss=0,cells=0;
    for(let i=0;i<N/20;i++){ const row=generateRow(y); for(const t of row){cells++; if(t===7)dark++; else if(t===8)gem++; else if(t===6)cop++; else if(t===2)moss++; } }
    return {dark:+(dark/cells*100).toFixed(2), gem:+(gem/cells*100).toFixed(2), copper:+(cop/cells*100).toFixed(1), moss:+(moss/cells*100).toFixed(1)};
  }
  const out={ d100_std:rates(100,'standard'), d200_std:rates(200,'standard'), d300_std:rates(300,'standard'), d300_hard:rates(300,'hard') };
  // レイス未解禁なら闇水晶0
  gameMode='standard'; shopData.wraith=false; maxDepth=0;
  const y=SKY_LAYERS+1+300; let dark=0,cells=0;
  for(let i=0;i<10000;i++){const row=generateRow(y);for(const t of row){cells++;if(t===7)dark++;}}
  out.d300_noWraith_dark=+(dark/cells*100).toFixed(2);
  process.stdout.write(JSON.stringify(out)+"\n");
})();
