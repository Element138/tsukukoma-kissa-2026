import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { counterAlertSources } from "../lib/counter-age-alerts";
import { COUNTER_ALERT_MINUTES } from "../lib/counter-age-alerts";

async function main(){
  const orderNo=Number(process.argv[2]??258);
  if(!Number.isInteger(orderNo)||orderNo<1||orderNo>2000)throw Error("Use a cached order number (1–2000)");
  const output=resolve("tmp/counter-samples");await mkdir(output,{recursive:true});
  for(const minutes of COUNTER_ALERT_MINUTES){
    const sources=counterAlertSources({id:"sample",orderNo,createdAt:new Date().toISOString(),minutes});
    const destination=resolve(output,`order-${orderNo}-${minutes}-minutes.mp3`);
    execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-y",...sources.flatMap(source=>["-i",resolve("public",source.slice(1))]),"-filter_complex","[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]","-map","[out]","-codec:a","libmp3lame","-b:a","192k",destination],{stdio:"inherit"});
    console.log(destination);
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
