import { createCipheriv, createHash, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDZgjVwAiKTjZ55nG+mW6r3TSU4
ECvNYqDMIS/bhCj2QaH5GI/KZb2TBp+CBvUj9SLFnmJQ0kzHzHoGZCQ88VevCffF7JePGF9cmKQqotlfTKbV4oxV5iLz7JSG6b/Vg7AXtrTolNtWsa8HiB0tI0YClYaQlOXm4UxLeSxQwSFETwIDAQAB
-----END PUBLIC KEY-----`;
const md5 = (value) => createHash('md5').update(value).digest('hex');
export const androidBase64 = (bytes) => bytes.toString('base64').match(/.{1,76}/g).join('\n') + '\n';
export function encryptReport(events, time = String(Math.floor(Date.now() / 1000))) {
    const aesKey = randomBytes(8).toString('hex');
    const cipher = createCipheriv('aes-128-cbc', Buffer.from(aesKey), Buffer.from('abcdefghijklmnop'));
    const payload = gzipSync(Buffer.from(JSON.stringify({ events })));
    const data = androidBase64(Buffer.concat([cipher.update(payload), cipher.final()]));
    const key = androidBase64(publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(aesKey)));
    return { data, key, sid: md5(key + time) + md5(data), time };
}
export function shareEvent(action, addition, sessionId, time = Math.floor(Date.now() / 1000)) {
    if (!['show', 'tap', 'success'].includes(action))
        throw new Error('未知分享事件');
    return {
        type: action === 'tap' ? '4' : '3', path: `/share/behavior/${action}`, time: String(time),
        addition: { ...addition, ...(action === 'show' ? {} : { plat: 'WechatSession' }), h_session_id: sessionId },
    };
}
