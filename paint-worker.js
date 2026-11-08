import {parentPort,workerData} from 'node:worker_threads';
import {runPaint,encodePng} from './paint-engine.js';
import {paintPixelDiff,paintPatchEmpty} from './public/paint-pixels-v1.js';
try{
  let previous=workerData.state;
  const report=workerData.progress?state=>{
    const patch=paintPixelDiff(previous,state);
    previous=state;
    if(!paintPatchEmpty(patch))parentPort.postMessage({progress:patch});
  }:null;
  const result=runPaint(workerData,report);
  parentPort.postMessage(report?{ok:true,state:result.state}:{ok:true,state:result.state,gif:new Uint8Array(result.gif),png:encodePng(result.state.width,result.state.height,result.rgba)});
}
catch(error){
  parentPort.postMessage({ok:false,error:error.code==='ERR_SCRIPT_EXECUTION_TIMEOUT'
    ?'这一批笔迹处理超时，可把还没画的部分分批加到同一张画布。'
    :'画布处理失败，请检查笔刷和坐标后重试'});
}
