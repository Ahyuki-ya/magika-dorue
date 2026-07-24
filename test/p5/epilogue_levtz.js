(function(){
  // 宝石鉱脈率（深度1000, L別）
  function gemRate(L){
    leverage={active:L>1,stake:0,mult:L}; gameMode=L>1?'hard':'standard';
    if(typeof shopData==='object') shopData.wraith=false;
    const y=SKY_LAYERS+1+1000; const N=400000; let gem=0,cells=0;
    for(let i=0;i<N/20;i++){const row=generateRow(y);for(const t of row){cells++;if(t===8)gem++;}}
    return +(gem/cells*100).toFixed(3);
  }
  // レア度分布（実深度d, L別）
  function rar(d,L){
    const N=400000; const cnt=[0,0,0,0,0,0];
    for(let i=0;i<N;i++)cnt[rollRarityIndex(d,L)]++;
    const p=cnt.map(c=>+(c/N*100).toFixed(1));
    return `並${p[0]} 良${p[1]} 稀${p[2]} 極${p[3]} 伝${p[4]}`;
  }
  const out={
    gem_d1000: {L1:gemRate(1),L2:gemRate(2),L5:gemRate(5),L10:gemRate(10)},
    rar_d300_L1: rar(300,1), rar_d300_L3: rar(300,3), rar_d300_L10: rar(300,10),
    rar_d500_L1: rar(500,1), rar_d500_L2: rar(500,2), rar_d500_L5: rar(500,5),
    rar_d400_L10_legendaryGate: rar(400,10),   // 実深<500 → 伝説0のはず
  };
  process.stdout.write(JSON.stringify(out)+"\n");
})();
