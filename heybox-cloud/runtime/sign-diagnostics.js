import { HeyboxApiError } from './client.js';
function object(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
function number(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
        return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
// Only state is retained verbatim; never retain complete replies or other raw fields.
export function signResponse(value) {
    const data = object(value), reward = data.popup ? object(object(data.popup).data) : data;
    const state = typeof data.state === 'string' && /^[a-z_]{1,32}$/.test(data.state) ? data.state : undefined;
    const stateType = data.state === null ? 'null' : Array.isArray(data.state) ? 'array' : typeof data.state;
    const resultType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const fields = ['state', 'signed_date', 'description', 'notify_description', 'coin', 'sign_in_coin',
        'sign_in_exp', 'sign_in_member_coin', 'sign_in_streak', 'plus_exp', 'plus_hcoin', 'level_info', 'popup'];
    return {
        state: state ?? 'unknown',
        state_source: !Object.hasOwn(data, 'state') ? 'missing' : state === undefined ? 'redacted' : 'value',
        state_type: Object.hasOwn(data, 'state') ? stateType : 'missing',
        state_raw: data.state,
        result_type: resultType,
        field_count: resultType === 'object' ? Object.keys(data).length : undefined,
        fields: fields.filter(key => Object.hasOwn(data, key)),
        signed_date: number(data.signed_date),
        reward: {
            sign_in_exp: number(reward.sign_in_exp), sign_in_coin: number(reward.sign_in_coin),
            sign_in_streak: number(reward.sign_in_streak),
            plus_exp: typeof reward.plus_exp === 'boolean' ? reward.plus_exp : undefined,
            plus_hcoin: typeof reward.plus_hcoin === 'boolean' ? reward.plus_hcoin : undefined,
        },
    };
}
export function signBalance(value) {
    return { exp: value.exp, level: value.level, maxExp: value.maxExp, coin: value.coin, battery: value.battery };
}
export function signFailure(error) {
    const message = error instanceof Error ? error.message : '';
    return { category: error instanceof HeyboxApiError ? 'upstream_rejected'
            : /登录已过期|设备令牌无效/.test(message) ? 'auth'
                : /请求失败或超时/.test(message) ? 'network' : /^HTTP /.test(message) ? 'http' : 'unknown',
        status: error instanceof HeyboxApiError ? error.status : undefined,
        httpStatus: /^HTTP (\d{3})：/.exec(message)?.[1] };
}
export async function readSignHistory(client, time) {
    const date = new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
    try {
        const result = object(await client.web('/store/hcoin/history/', { offset: '0', limit: '30' }));
        if (!Array.isArray(result.history))
            return { status: 'invalid', date };
        const rows = result.history.slice(0, 30);
        const entries = [];
        for (const row of rows) {
            const item = object(row);
            if (item.event_desc !== '完成签到任务')
                continue;
            const timestamp = item.timestamp, value = number(item.value);
            if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(timestamp)
                || item.type !== 'inc' || value === undefined)
                return { status: 'invalid', date };
            if (timestamp.slice(0, 10) === date)
                entries.push({ timestamp, value });
        }
        return { status: 'ok', date, scanned: rows.length, limited: result.history.length >= 30, entries };
    }
    catch (error) {
        return { status: 'unavailable', date, error: signFailure(error) };
    }
}
