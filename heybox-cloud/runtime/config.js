import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
export function validateConfig(input) {
    const config = input;
    for (const [section, keys] of Object.entries({
        session: ['heybox_id', 'pkey', 'device_id', 'x_xhh_tokenid'],
        device: ['model', 'osVersion'], app: ['version', 'build', 'shaderVersion'],
    })) {
        for (const key of keys) {
            const value = config?.[section]?.[key];
            if (typeof value !== 'string' || !value || /[\r\n;]/.test(value))
                throw new Error(`配置缺少或无效：${section}.${key}`);
        }
    }
    const valid = config;
    if (!/^\d+$/.test(valid.session.heybox_id))
        throw new Error('请填写真实的盒友 ID');
    if (valid.app.version !== '1.3.398' || valid.app.build !== '1142' || valid.app.shaderVersion !== '14') {
        throw new Error('当前仅验证了 APP 1.3.398 / build 1142 / shader 14，请使用配套资源');
    }
    return valid;
}
export function configPath() { return path.resolve(process.env.HEYBOX_CONFIG || 'private/config.json'); }
export function saveConfig(input, file = configPath()) {
    const config = validateConfig(input);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        renameSync(temporary, file);
    }
    finally {
        rmSync(temporary, { force: true });
    }
}
export function loadConfig() {
    const file = configPath();
    let data;
    try {
        data = JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        throw new Error('无法读取账号配置，请先运行 docker compose run --rm login');
    }
    return validateConfig(data);
}
