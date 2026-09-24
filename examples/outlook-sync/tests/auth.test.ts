import { describe, expect, it } from 'vitest';
import { isMicrosoftDeviceVerificationUri } from '../src/auth.js';

describe('Microsoft device authorization', () => {
  it('allows only Microsoft device-login endpoints', () => {
    expect(isMicrosoftDeviceVerificationUri('https://microsoft.com/devicelogin')).toBe(true);
    expect(isMicrosoftDeviceVerificationUri('https://www.microsoft.com/link')).toBe(true);
    expect(isMicrosoftDeviceVerificationUri('https://microsoft.com.evil.example/link')).toBe(false);
    expect(isMicrosoftDeviceVerificationUri('http://www.microsoft.com/link')).toBe(false);
  });
});
