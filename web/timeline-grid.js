export const DEFAULT_GRID = Object.freeze({mode:'seconds', bpm:120, beatsPerBar:4, offsetMs:0, configured:false});

export function validateGrid(value, durationMs) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('격자 설정이 잘못되었습니다.');
 const {mode,bpm,beatsPerBar,offsetMs,configured}=value;
 if (!['seconds','beats'].includes(mode)) throw Error('초 또는 박자 단위를 선택하세요.');
 if (!Number.isFinite(bpm) || bpm<20 || bpm>300) throw Error('BPM은 20~300으로 입력하세요.');
 if (!Number.isInteger(beatsPerBar) || beatsPerBar<1 || beatsPerBar>12) throw Error('한 마디의 박 수는 1~12로 입력하세요.');
 if (!Number.isFinite(offsetMs) || offsetMs<0 || offsetMs>=durationMs) throw Error('첫 박은 음원 길이 안의 시간으로 지정하세요.');
 if (typeof configured!=='boolean') throw Error('격자 설정 상태가 잘못되었습니다.');
 return {mode,bpm,beatsPerBar,offsetMs,configured};
}

// Integer beat indexes avoid accumulated rounding drift. At a wide zoom we
// thin measures, always retaining their true musical positions and numbers.
export function beatTicks(durationMs, width, grid) {
 if (!(durationMs>0) || !(width>0)) return [];
 const {bpm,beatsPerBar,offsetMs}=validateGrid(grid,durationMs);
 const beatMs=60000/bpm, beatPx=beatMs/durationMs*width;
 const stride=beatPx>=18 ? 1 : beatsPerBar*Math.max(1,Math.ceil(70/(beatPx*beatsPerBar)));
 const last=Math.ceil((durationMs-offsetMs)/beatMs), ticks=[];
 for(let index=0;index<last;index+=stride){
  const ms=offsetMs+index*beatMs, major=index%beatsPerBar===0;
  ticks.push({ms,major,label:major||beatPx>=48?`${Math.floor(index/beatsPerBar)+1}.${index%beatsPerBar+1}`:''});
 }
 return ticks;
}
