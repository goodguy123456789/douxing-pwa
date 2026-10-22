export type DevelopmentEnvironment = Record<string, string | undefined>;

export function prepareApiEnvironment(
  environment: DevelopmentEnvironment,
): DevelopmentEnvironment;

export function webDevelopmentOptions(
  environment: DevelopmentEnvironment,
  defaultPort?: number,
): {
  port: number;
  base: string;
  host: string;
  proxy: Record<string, { target: string }> | undefined;
};
