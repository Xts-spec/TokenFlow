import {it,expect} from 'vitest';
import {workspaceWindowOptions,windowsTitleBar} from '../apps/desktop/src/window-options.js';

it('uses the same integrated Windows frame for startup and workspace while retaining native controls',()=>{
 const options=workspaceWindowOptions('fixture.png','win32');
 expect(options.titleBarStyle).toBe('hidden');expect(options.autoHideMenuBar).toBe(true);
 expect(options.titleBarOverlay).toMatchObject({height:40,color:'#161719',symbolColor:'#ececef'});
 expect(options.frame).not.toBe(false);expect(options.minWidth).toBe(900);
});
it('keeps the existing macOS traffic lights and default Linux frame',()=>{
 expect(workspaceWindowOptions('fixture.png','darwin')).toMatchObject({titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:20}});
 expect(workspaceWindowOptions('fixture.png','darwin').titleBarOverlay).toBeUndefined();
 expect(workspaceWindowOptions('fixture.png','linux').titleBarStyle).toBeUndefined();
});
it('keeps Windows caption symbols readable in both application themes',()=>{
 expect(windowsTitleBar('dark')).toEqual({height:40,color:'#161719',symbolColor:'#ececef'});
 expect(windowsTitleBar('light')).toEqual({height:40,color:'#f7f9fc',symbolColor:'#202123'});
});
