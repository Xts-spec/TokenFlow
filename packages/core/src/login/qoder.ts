import { deviceProvider } from './device-flow.js';

/** Qoder IDE 模型来源账号。设备码/网页授权流程，在官方页面登录并确认授权。 */
export const qoder = deviceProvider({
  id: 'qoder',
  label: 'Qoder IDE',
  hint: '阿里 Qoder IDE 账号授权',
  route: '/qoder-auth-url',
  accountProvider: 'qoder',
  modelTypes: ['qoder'],
  verification: { host: 'qoder.com', path: '/device/selectAccounts' },
  requireUserCode: false,
});
