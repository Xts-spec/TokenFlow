import {describe,it,expect} from 'vitest';
import {qoderAccountingReader} from '../packages/core/src/qoder-accounting.js';
describe('Qoder billing output',()=>{
 it('keeps zero and false across chunks, discarding secrets and other logs',()=>{
  const output:string[]=[];const receive=qoderAccountingReader(line=>output.push(line));
  receive('SECRET raw error\n[info] qoder upstream account');
  receive('ing billable=false credits=0 secret=PRIVATE\nqoder upstream accounting billable=true credits=1.25e-3\n');
  expect(output).toEqual(['qoder upstream accounting billable=false credits=0','qoder upstream accounting billable=true credits=0.00125']);
 });
 it('drops oversized lines and rejects strings or nonfinite amounts',()=>{
  const output:string[]=[];const receive=qoderAccountingReader(line=>output.push(line));
  receive('x'.repeat(9000));receive('qoder upstream accounting billable=true credits=9\n');
  receive('qoder upstream accounting billable="SECRET" credits=Infinity\n');
  receive('qoder upstream accounting billable=false credits=0\n');
  expect(output).toEqual(['qoder upstream accounting billable=false credits=0']);
 });
});
