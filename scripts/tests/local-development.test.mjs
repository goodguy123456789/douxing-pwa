import assert from 'node:assert/strict';
import test from 'node:test';
import {
  prepareApiEnvironment,
  webDevelopmentOptions,
} from '../development-env.mjs';

test('本地后端缺少数据库配置时在构建和连接前拒绝启动', () => {
  assert.throws(() => prepareApiEnvironment({}), /DATABASE_URL/);
});

test('本地后端拒绝远程数据库及连接参数中的远程主机', () => {
  for (const url of [
    'postgresql://user:private-password@database.example/duoxing',
    'postgresql://user:private-password@localhost.example/duoxing',
    'postgresql://user:private-password@127.0.0.1/duoxing?host=database.example',
    'https://127.0.0.1/duoxing',
  ]) {
    assert.throws(
      () => prepareApiEnvironment({ DATABASE_URL: url }),
      (error) => {
        assert.match(error.message, /本地|DATABASE_URL/);
        assert.doesNotMatch(error.message, /private-password/);
        return true;
      },
    );
  }
});

test('本地后端只监听回环地址，并默认使用 Token 开发模式', () => {
  const env = prepareApiEnvironment({
    DATABASE_URL: 'postgresql://dev:local@127.0.0.1:5432/duoxing_dev',
    HOST: '0.0.0.0',
  });
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PORT, '5000');
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.DUOXING_AUTH_MODE, 'token');
});

test('本地后端支持 IPv6 回环地址和单独配置的 API 端口', () => {
  const env = prepareApiEnvironment({
    DATABASE_URL: 'postgresql://dev:local@[::1]:5432/duoxing_dev',
    API_PORT: '5001',
  });
  assert.equal(env.PORT, '5001');
});

test('本地前端默认端口和 API 代理均指向本机', () => {
  const options = webDevelopmentOptions({});
  assert.equal(options.port, 5173);
  assert.equal(options.base, '/');
  assert.equal(options.host, '127.0.0.1');
  assert.deepEqual(options.proxy, {
    '/api': { target: 'http://127.0.0.1:5000' },
  });
  const custom = webDevelopmentOptions({ WEB_PORT: '5175', API_PORT: '5001' });
  assert.equal(custom.port, 5175);
  assert.equal(custom.proxy['/api'].target, 'http://127.0.0.1:5001');
});

test('端口无效时给出配置错误而不是启动服务', () => {
  for (const port of ['0', '65536', 'abc', '5000.5']) {
    assert.throws(() => webDevelopmentOptions({ WEB_PORT: port }), /端口/);
    assert.throws(
      () =>
        prepareApiEnvironment({
          DATABASE_URL: 'postgresql://dev:local@localhost/duoxing_dev',
          API_PORT: port,
        }),
      /端口/,
    );
  }
});

test('Replit 开发环境保留原有数据库、监听方式和端口配置', () => {
  const input = {
    REPL_ID: 'existing-workspace',
    PORT: '8080',
    BASE_PATH: '/app/',
    DATABASE_URL: 'postgresql://dev:local@replit-development-db/duoxing',
    DUOXING_AUTH_MODE: 'legacy',
  };
  const env = prepareApiEnvironment(input);
  assert.equal(env.DATABASE_URL, input.DATABASE_URL);
  assert.equal(env.PORT, '8080');
  assert.equal(env.HOST, undefined);
  assert.equal(env.DUOXING_AUTH_MODE, 'legacy');
  const web = webDevelopmentOptions(input);
  assert.equal(web.port, 8080);
  assert.equal(web.base, '/app/');
  assert.equal(web.host, '0.0.0.0');
  assert.equal(web.proxy, undefined);
});
