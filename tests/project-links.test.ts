import {describe,expect,it,vi} from 'vitest';
import {PROJECT_LINKS,projectWindowOpenHandler} from '../apps/shared/project-links';

describe('desktop project links',()=>{
 it.each(Object.entries(PROJECT_LINKS))('opens the %s link from the settings page',async(_name,url)=>{
  const open=vi.fn(async(_url:string)=>{}),error=vi.fn();
  const handler=projectWindowOpenHandler(open,error);
  // Chromium encodes the Chinese README anchor before invoking this handler.
  const browserURL=new URL(url).href;
  expect(handler({url:browserURL})).toEqual({action:'deny'});
  expect(open).toHaveBeenCalledExactlyOnceWith(browserURL);
  await Promise.resolve();expect(error).not.toHaveBeenCalled();
 });
 it('reports a browser launch failure',async()=>{
  const error=vi.fn(),handler=projectWindowOpenHandler(async()=>{throw new Error('Browser unavailable');},error);
  handler({url:PROJECT_LINKS.home});await Promise.resolve();
  expect(error).toHaveBeenCalledExactlyOnceWith(PROJECT_LINKS.home);
 });
 it.each(['https://github.com/haruinia/OtherProject','https://github.com/haruinia/TokenFlow.evil','https://github.com.evil/haruinia/TokenFlow','http://github.com/haruinia/TokenFlow','file:///etc/passwd','javascript:alert(1)','not a url'])('keeps unsupported destinations blocked: %s',url=>{
  const open=vi.fn(async()=>{}),handler=projectWindowOpenHandler(open,vi.fn());
  expect(handler({url})).toEqual({action:'deny'});expect(open).not.toHaveBeenCalled();
 });
});
