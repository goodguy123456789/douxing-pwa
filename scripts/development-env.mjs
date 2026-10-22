function developmentPort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('开发端口必须是 1 到 65535 之间的整数。');
  }
  return port;
}

export function prepareApiEnvironment(environment) {
  const env = { ...environment, NODE_ENV: 'development' };
  if (env.REPL_ID) return env;

  if (!env.DATABASE_URL) {
    throw new Error('请先配置独立本地开发数据库的 DATABASE_URL。');
  }
  let database;
  try {
    database = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL 格式无效，请使用本地 PostgreSQL 连接。');
  }
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  const hosts = [database.hostname];
  for (const key of ['host', 'hostaddr']) {
    if (database.searchParams.has(key))
      hosts.push(database.searchParams.get(key));
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    hosts.some((host) => !localHosts.has(host))
  ) {
    throw new Error(
      '本地开发入口仅允许回环地址的 DATABASE_URL，拒绝连接远程数据库。',
    );
  }
  env.HOST = '127.0.0.1';
  env.PORT = String(developmentPort(env.API_PORT ?? env.PORT, 5000));
  env.DUOXING_AUTH_MODE ??= 'token';
  return env;
}

export function webDevelopmentOptions(environment, defaultPort = 5173) {
  const isReplit = Boolean(environment.REPL_ID);
  if (isReplit && !environment.PORT) {
    throw new Error('Replit 环境需要配置 PORT。');
  }
  const base = environment.BASE_PATH ?? (isReplit ? undefined : '/');
  if (!base) throw new Error('请配置 BASE_PATH。');
  const port = developmentPort(
    isReplit ? environment.PORT : (environment.WEB_PORT ?? environment.PORT),
    defaultPort,
  );
  return {
    port,
    base,
    host: isReplit ? '0.0.0.0' : '127.0.0.1',
    proxy: isReplit
      ? undefined
      : {
          '/api': {
            target: `http://127.0.0.1:${developmentPort(environment.API_PORT, 5000)}`,
          },
        },
  };
}
