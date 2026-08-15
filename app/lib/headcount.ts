export type OtiTargets = { oti1:number; oti2:number; oti3:number };

const clampSkill = (value:number) => Math.max(0,Math.min(32,Math.round(value)));

/** Jana sasaran tetap pada 25%, 50% dan 75% daripada laluan TOV ke ETR. */
export function generateOtiTargets(tov:number,etr:number):OtiTargets{
  const start=clampSkill(tov),end=clampSkill(etr);
  if(end<start)throw new Error("ETR hendaklah sama atau lebih tinggi daripada TOV.");
  if(end===start)return {oti1:start,oti2:start,oti3:start};
  const distance=end-start;
  const raw=[.25,.5,.75].map(portion=>clampSkill(start+distance*portion));
  if(distance<4){
    const values=raw.map(value=>Math.max(start,Math.min(end,value)));
    return {oti1:values[0],oti2:Math.max(values[0],values[1]),oti3:Math.max(values[1],values[2])};
  }
  const values:number[]=[];
  raw.forEach((value,index)=>{
    const minimum=index===0?start+1:values[index-1]+1;
    const maximum=end-(2-index);
    values.push(Math.max(minimum,Math.min(maximum,value)));
  });
  return {oti1:values[0],oti2:values[1],oti3:values[2]};
}

export function validateManualTargets(tov:number,targets:OtiTargets,etr:number):string|null{
  if(etr<tov)return "ETR hendaklah sama atau lebih tinggi daripada TOV.";
  const ordered=tov<=targets.oti1&&targets.oti1<=targets.oti2&&targets.oti2<=targets.oti3&&targets.oti3<=etr;
  return ordered?null:"Pastikan TOV ≤ OTI 1 ≤ OTI 2 ≤ OTI 3 ≤ ETR.";
}

export function arProgress(ar:number,oti:number,etr:number){
  if(ar<=0)return {status:"BELUM DINILAI",tone:"gray",comparison:"AR belum direkodkan",remainder:"Menunggu penilaian AR"};
  if(oti<=0||etr<=0)return {status:"SASARAN BELUM DITETAPKAN",tone:"amber",comparison:"Tetapkan TOV dan ETR dahulu",remainder:"Baki ETR belum dapat dikira"};
  if(ar>etr)return {status:"MELEBIHI ETR",tone:"green",comparison:`Melebihi sasaran sebanyak ${Math.max(ar-oti,0)} KP`,remainder:"ETR Tercapai"};
  const difference=ar-oti;
  const status=difference>0?"MELEBIHI SASARAN":difference===0?"SASARAN TERCAPAI":"BELUM MENCAPAI SASARAN";
  const tone=difference>=0?"green":difference>=-2?"amber":"red";
  const comparison=difference>0?`Melebihi sasaran sebanyak ${difference} KP`:difference===0?"Sasaran tercapai":`Kurang ${Math.abs(difference)} KP daripada sasaran`;
  return {status,tone,comparison,remainder:ar>=etr?"ETR Tercapai":`Baki ke ETR: ${etr-ar} KP`};
}
