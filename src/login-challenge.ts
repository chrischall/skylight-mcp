import {
  InvalidVerificationCodeError,
  VerificationCodeRequiredError,
  type LoginChallenge,
  type Tokens,
} from './auth-session-login.js';

/**
 * Holds an emailed-code login open between tool calls (#276).
 *
 * Skylight can answer the password with a one-time code mailed to the
 * account. The code arrives out of band, so the login cannot finish inside
 * the tool call that started it: the call fails with
 * {@link VerificationCodeRequiredError}, this holder keeps the challenge, and
 * `skylight_submit_login_code` finishes it. Until then every other tool call
 * re-reports the same challenge rather than starting a new login — a new
 * login would mail a new code and invalidate the one the user is reading.
 *
 * Process-local by design: the challenge is a live cookie session. A restart
 * loses it, and the next tool call simply starts (and mails) a fresh one.
 */
export class PendingLogin {
  private challenge?: LoginChallenge;
  private minted?: Tokens;

  /** Whether a code is awaited. */
  get pending(): boolean {
    return this.challenge !== undefined;
  }

  /** Tokens a submitted code produced, handed over once to the token bootstrap. */
  take(): Tokens | undefined {
    const t = this.minted;
    this.minted = undefined;
    return t;
  }

  /**
   * Run `login` unless a challenge is already open; capture a new challenge
   * when the login raises one.
   */
  async login(login: () => Promise<Tokens>): Promise<Tokens> {
    const ready = this.take();
    if (ready) return ready;
    if (this.challenge) throw new VerificationCodeRequiredError(this.challenge);
    try {
      return await login();
    } catch (err) {
      if (err instanceof VerificationCodeRequiredError) this.challenge = err.challenge;
      throw err;
    }
  }

  /** Verify `code`; on success the tokens wait for the next {@link take}. */
  async submit(code: string): Promise<void> {
    const challenge = this.requireChallenge();
    try {
      this.minted = await challenge.submit(code);
      this.challenge = undefined;
    } catch (err) {
      this.dropUnlessRetryable(err);
      throw err;
    }
  }

  /** Ask Skylight to mail a fresh code for the open challenge. */
  async resend(): Promise<void> {
    const challenge = this.requireChallenge();
    try {
      await challenge.resend();
    } catch (err) {
      this.dropUnlessRetryable(err);
      throw err;
    }
  }

  private requireChallenge(): LoginChallenge {
    if (!this.challenge) {
      throw new Error(
        'No Skylight login is waiting for a code. Call any Skylight tool (e.g. skylight_healthcheck) first; ' +
          'if Skylight asks for a code it will email one and say so.',
      );
    }
    return this.challenge;
  }

  /**
   * A mistyped code leaves the challenge usable; anything else (session
   * expired, too many attempts, network) means the next tool call should
   * start a clean login rather than reporting a dead challenge forever.
   */
  private dropUnlessRetryable(err: unknown): void {
    if (!(err instanceof InvalidVerificationCodeError)) this.challenge = undefined;
  }
}
