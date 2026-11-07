import { isSwaggerEnabled } from './app.setup';

describe('isSwaggerEnabled', () => {
  it('masqué par défaut en production', () => {
    expect(isSwaggerEnabled('production', undefined)).toBe(false);
  });

  it('visible par défaut hors production', () => {
    expect(isSwaggerEnabled('development', undefined)).toBe(true);
    expect(isSwaggerEnabled(undefined, undefined)).toBe(true);
  });

  it('SWAGGER_ENABLED force l’un ou l’autre', () => {
    expect(isSwaggerEnabled('production', 'true')).toBe(true);
    expect(isSwaggerEnabled('development', 'false')).toBe(false);
  });
});
