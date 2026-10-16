import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {FileCleanup,type FileCleanupOptions} from './file-cleanup.js';

export function registerFileCleanup(app:FastifyInstance,profile:string,options?:FileCleanupOptions,beforeClean?:()=>void){
 const cleanup=new FileCleanup(profile,options);
 app.get('/api/file-cleanup',async()=>cleanup.snapshot());
 app.post('/api/file-cleanup/scan',async req=>{z.object({}).strict().parse(req.body);return cleanup.start();});
 app.post('/api/file-cleanup/cancel',async req=>{z.object({}).strict().parse(req.body);return cleanup.cancel();});
 app.post('/api/file-cleanup/scope',async req=>{const {scope}=z.object({scope:z.enum(['common','all'])}).strict().parse(req.body);return cleanup.configureScope(scope);});
 app.post('/api/file-cleanup/project-roots',async req=>{z.object({}).strict().parse(req.body);return cleanup.addProjectRoot();});
 app.delete('/api/file-cleanup/project-roots/:index',async req=>cleanup.removeProjectRoot(z.coerce.number().int().min(0).parse((req.params as {index:string}).index)));
 app.post('/api/file-cleanup/trash',async req=>{
  const input=z.object({scanId:z.string().uuid(),ids:z.array(z.string().uuid()).min(1).max(200),confirmReview:z.boolean().default(false),confirmProtected:z.boolean().default(false)}).strict().parse(req.body);
  beforeClean?.();
  return cleanup.clean(input.scanId,input.ids,input.confirmReview,'trash',false,input.confirmProtected);
 });
 app.post('/api/file-cleanup/clean',async req=>{
  const input=z.object({scanId:z.string().uuid(),ids:z.array(z.string().uuid()).min(1).max(200),method:z.enum(['trash','delete']),confirmReview:z.boolean().default(false),confirmPermanent:z.boolean().default(false),confirmProtected:z.boolean().default(false)}).strict().parse(req.body);
  beforeClean?.();return cleanup.clean(input.scanId,input.ids,input.confirmReview,input.method,input.confirmPermanent,input.confirmProtected);
 });
 app.post('/api/file-cleanup/reveal',async req=>{const {id}=z.object({id:z.string().uuid()}).strict().parse(req.body);return cleanup.reveal(id);});
 app.addHook('onClose',async()=>cleanup.close());
 return cleanup;
}
