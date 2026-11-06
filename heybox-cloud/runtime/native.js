import { signNative } from './native-algorithm.js';
import { normalizePath } from './signature.js';
export function nativeSignature(endpoint, config) {
    if (config.app.version !== '1.3.398' || config.app.build !== '1142' || config.app.shaderVersion !== '14') {
        throw new Error('原生签名仅支持 APP 1.3.398 / build 1142 / shader 14');
    }
    return signNative({
        path: normalizePath(endpoint), time: String(Math.floor(Date.now() / 1000)),
        debugInfo: config.session.device_id + config.session.heybox_id,
        osVersion: config.device.osVersion, version: config.app.version,
    });
}
