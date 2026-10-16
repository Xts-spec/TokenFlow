import type {BrowserWindowConstructorOptions} from 'electron';

/** Startup and workspace share the same native frame and initial size. */
export function windowsTitleBar(theme:'dark'|'light'){
 return {color:theme==='light'?'#f7f9fc':'#161719',symbolColor:theme==='light'?'#202123':'#ececef',height:40};
}
export function workspaceWindowOptions(icon:string,platform=process.platform):BrowserWindowConstructorOptions{
 return {width:1320,height:900,minWidth:900,minHeight:640,show:false,backgroundColor:'#161719',title:'TokenFlow',icon,
  ...(platform==='darwin'?{titleBarStyle:'hiddenInset' as const,trafficLightPosition:{x:20,y:20}}:{}),
  ...(platform==='win32'?{autoHideMenuBar:true,titleBarStyle:'hidden' as const,titleBarOverlay:windowsTitleBar('dark')}:{})};
}
