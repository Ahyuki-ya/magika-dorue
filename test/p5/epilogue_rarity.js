// レア度分布の実測。各深度で rollRarityIndex を多数回まわし%を測る。
(function () {
  function dist(depth) {
    const N = 500000;
    const cnt = [0,0,0,0,0,0];
    for (let i = 0; i < N; i++) cnt[rollRarityIndex(depth)]++;
    return cnt.map(c => +(c / N * 100).toFixed(2));
  }
  const label = ['並','良','稀','極','伝説','神'];
  const out = {};
  for (const d of [0, 250, 500, 750, 1000, 2000]) {
    const a = dist(d);
    out['d'+d] = label.map((l,i)=>`${l}${a[i]}`).join(' ');
  }
  process.stdout.write(JSON.stringify(out, null, 0) + '\n');
})();
