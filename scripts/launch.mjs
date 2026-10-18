import {spawn} from 'node:child_process';
import {createApp} from '../server/main.mjs';
try {
  const app=await createApp();
  console.log(`LyricFlow Studio 0.2\n${app.url}\nKeep this terminal open while working. Stop: Ctrl+C`);
  const command=process.platform==='win32'?'cmd':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['/d','/s','/c',`start "" "${app.url}"`]:[app.url];
  // cmd.exe parses its own quotes; Node's default argument quoting adds
  // backslashes that break `start "" "URL"` on Windows.
  const browser=spawn(command,args,{stdio:'ignore',windowsHide:true,windowsVerbatimArguments:process.platform==='win32'});
  browser.on('error',()=>console.log(`Open ${app.url} in your browser.`));
  browser.on('exit',code=>{if(code)console.log(`Open ${app.url} in your browser.`);});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}catch(error){console.error(error.message);process.exitCode=1;}
