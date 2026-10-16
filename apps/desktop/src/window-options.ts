import type {BrowserWindowConstructorOptions} from 'electron';

/** Startup and workspace share the same native frame and initial size. */
export function workspaceWindowOptions(icon:string):BrowserWindowConstructorOptions{
 return {width:1320,height:900,minWidth:900,minHeight:640,show:false,backgroundColor:'#161719',title:'TokenFlow',icon,
  ...(process.platform==='darwin'?{titleBarStyle:'hiddenInset' as const,trafficLightPosition:{x:20,y:20}}:{})};
}
