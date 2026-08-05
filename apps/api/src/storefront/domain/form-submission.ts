/**
 * Storefront · domain/form-submission.ts
 * What a storefront form POST means, and whether to accept it.
 *
 * This is the only place on the platform where an **anonymous stranger writes
 * data**. Everything else is a merchant with a session or an app with a token;
 * here it is whoever followed a link. That changes which defences matter, and
 * it is worth being precise rather than reaching for the usual list.
 *
 * **CSRF is not the main risk, and pretending otherwise buys nothing.** Forging
 * a request on behalf of an anonymous visitor accomplishes what that visitor
 * could do themselves — send an enquiry. There is no privileged action to
 * hijack. The forms that DO carry authority are the account ones, and those
 * have a session to bind a token to; those are checked, and the public ones are
 * checked by origin instead.
 *
 * **Spam and abuse are the real risks.** A public POST on every store is a
 * quote inbox anyone can fill. So: a rate limit, an origin check, a honeypot,
 * and a submission that is refused rather than half-stored.
 *
 * The outcome model is the reference product's, and it is right: a failure
 * re-renders the page with `form.errors` populated, and a success REDIRECTS. A
 * success that re-rendered would resubmit on refresh, and a merchant would find
 * the same enquiry four times.
 * Layer: domain (pure).
 */

/** Forms a storefront may post, and what each one is for. */
export const FORM_TYPES = [
  'contact',
  'customer',
  'product',
  'cart',
  'customer_login',
  'customer_register',
  'customer_address',
  'recover_customer_password',
  'new_comment',
  'localization',
] as const;

export type FormType = (typeof FORM_TYPES)[number];

/**
 * Forms that act on behalf of somebody, rather than merely sending a message.
 *
 * These need a session and a token bound to it: changing an address or logging
 * in are actions another site must not be able to trigger. The rest are
 * strangers sending enquiries, where a forged submission achieves nothing the
 * forger could not do directly.
 */
const AUTHENTICATED_FORMS = new Set<string>([
  'customer_address',
  'customer_login',
  'customer_register',
  'recover_customer_password',
]);

export function needsSessionToken(type: string): boolean {
  return AUTHENTICATED_FORMS.has(type);
}

/**
 * The field a real person never fills in.
 *
 * Named plausibly so a bot's field-matching heuristics reach for it, hidden in
 * the markup so a person never sees it. Crude, and it stops the overwhelming
 * majority of automated submissions for the cost of one hidden input.
 */
export const HONEYPOT_FIELD = 'contact[fax]';

export interface SubmissionInput {
  readonly formType: string;
  readonly fields: Readonly<Record<string, string>>;
  /** The `Origin` header, or null when the browser sent none. */
  readonly origin: string | null;
  /** The host this store is served on. */
  readonly host: string;
  readonly hasSession: boolean;
  readonly tokenValid: boolean;
}

export type SubmissionRefusal =
  | 'unknown_form'
  | 'cross_origin'
  | 'honeypot'
  | 'needs_session'
  | 'bad_token';

export interface Accepted {
  readonly ok: true;
  readonly formType: FormType;
  readonly fields: Readonly<Record<string, string>>;
}

export interface Refused {
  readonly ok: false;
  readonly reason: SubmissionRefusal;
  /** What to tell the visitor. Deliberately vague where being specific helps an attacker. */
  readonly message: string;
}

/**
 * Decides whether to act on a submission.
 *
 * Ordered so the cheapest and least revealing checks run first — an unknown
 * form type is refused before anything looks at a token, and a bot tripping the
 * honeypot never reaches the rate limiter's budget.
 */
export function admitSubmission(input: SubmissionInput): Accepted | Refused {
  if (!(FORM_TYPES as readonly string[]).includes(input.formType)) {
    return {
      ok: false,
      reason: 'unknown_form',
      message: 'That form is not one this store accepts.',
    };
  }

  /**
   * The origin check, which is the real CSRF control for a public form.
   *
   * A browser sends `Origin` on every cross-site POST, and cannot be made to
   * lie about it — so a mismatch is another site submitting through a
   * customer's browser. A MISSING origin is allowed: some privacy tools strip
   * it, and refusing those would break the form for real people to prevent an
   * attack that gains the attacker nothing on a public form.
   */
  if (input.origin !== null && !sameHost(input.origin, input.host)) {
    return {
      ok: false,
      reason: 'cross_origin',
      message: 'This form was submitted from somewhere else and was not accepted.',
    };
  }

  /**
   * The honeypot, answered as though it succeeded.
   *
   * Telling a bot it was detected teaches whoever wrote it to stop filling the
   * field. The caller reports success and stores nothing.
   */
  if ((input.fields[HONEYPOT_FIELD] ?? '').trim() !== '') {
    return { ok: false, reason: 'honeypot', message: 'Thanks — your message has been sent.' };
  }

  if (needsSessionToken(input.formType)) {
    if (!input.hasSession) {
      return {
        ok: false,
        reason: 'needs_session',
        message: 'You need to be signed in to do that.',
      };
    }
    if (!input.tokenValid) {
      return {
        ok: false,
        reason: 'bad_token',
        message: 'That form has expired. Please reload the page and try again.',
      };
    }
  }

  return { ok: true, formType: input.formType as FormType, fields: input.fields };
}

/** Whether an Origin header names the host this store is served on. */
function sameHost(origin: string, host: string): boolean {
  try {
    const parsed = new URL(origin);
    // Port and scheme are ignored: a store behind a proxy is served on 443 and
    // reached on 80 in development, and neither changes who is submitting.
    return parsed.hostname.toLowerCase() === host.split(':')[0]?.toLowerCase();
  } catch {
    return false;
  }
}

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/**
 * Validates the fields a form type needs.
 *
 * Every message is written to be read by a customer rather than a developer:
 * "Enter an email address we can reply to" rather than "email is required".
 * This is the one error surface on the platform that a shopper sees.
 */
export function validateSubmission(
  formType: FormType,
  fields: Readonly<Record<string, string>>,
): readonly FieldError[] {
  const errors: FieldError[] = [];
  const value = (name: string): string => (fields[name] ?? '').trim();

  const requireEmail = (name = 'email') => {
    const email = value(name);
    if (email === '') {
      errors.push({ field: name, message: 'Enter an email address we can reply to.' });
      return;
    }
    // Deliberately permissive. A regex that tries to fully validate an address
    // rejects real ones, and the only real test is whether mail arrives.
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      errors.push({ field: name, message: "That doesn't look like an email address." });
    }
    if (email.length > 254) {
      errors.push({ field: name, message: 'That email address is too long.' });
    }
  };

  switch (formType) {
    case 'contact':
    case 'customer':
      requireEmail();
      if (value('body') === '') {
        errors.push({ field: 'body', message: 'Add a message so we know how to help.' });
      }
      break;

    case 'product':
    case 'cart':
      /**
       * A quote request. Phase-1 commerce is request-only (D10), so this is the
       * conversion action for the whole storefront — and the only field that is
       * genuinely required is a way to reply.
       */
      requireEmail();
      if (formType === 'product' && value('product_id') === '') {
        errors.push({ field: 'product_id', message: 'Choose a product to request a quote for.' });
      }
      break;

    case 'customer_login':
      requireEmail();
      if (value('password') === '') {
        errors.push({ field: 'password', message: 'Enter your password.' });
      }
      break;

    case 'customer_register':
      requireEmail();
      if (value('password').length < 8) {
        errors.push({ field: 'password', message: 'Use at least 8 characters.' });
      }
      break;

    case 'recover_customer_password':
      requireEmail();
      break;

    case 'new_comment':
      requireEmail();
      if (value('author') === '') {
        errors.push({ field: 'author', message: 'Add your name.' });
      }
      if (value('body') === '') {
        errors.push({ field: 'body', message: 'Write a comment before posting.' });
      }
      break;

    default:
      break;
  }

  /**
   * A ceiling on every field.
   *
   * These arrive from a stranger and end up in a database and a merchant's
   * inbox. Ten thousand characters is far more than any message needs and far
   * less than a payload worth sending.
   */
  for (const [name, held] of Object.entries(fields)) {
    if (held.length > 10_000) {
      errors.push({ field: name, message: 'That is longer than this form accepts.' });
    }
  }

  return errors;
}

/**
 * The state a re-rendered page needs after a failed submission.
 *
 * Deliberately the shape `formDrop` takes rather than the shape it PRODUCES.
 * The first version returned the drop's own output — `posted_successfully`,
 * `errors.translated_fields` — which rendered the error list correctly and left
 * `{{ form.email }}` empty, because themes read the fields off the form
 * directly and only the drop puts them there. Two shapes for one thing, and the
 * page was half right.
 */
export function formStateFor(
  formType: string,
  fields: Readonly<Record<string, string>>,
  errors: readonly FieldError[],
): {
  type: string;
  postedSuccessfully: boolean;
  errors: { messages: Record<string, string>; translatedFields: Record<string, string> } | null;
  fields: Record<string, string>;
} {
  return {
    type: formType,
    postedSuccessfully: errors.length === 0,
    errors:
      errors.length === 0
        ? null
        : {
            messages: Object.fromEntries(errors.map((error) => [error.field, error.message])),
            translatedFields: Object.fromEntries(
              errors.map((error) => [error.field, readableField(error.field)]),
            ),
          },
    // Never a password, whatever happened.
    fields: Object.fromEntries(
      Object.entries(fields).filter(([name]) => !/password/i.test(name)),
    ),
  };
}

/** `first_name` → `First name`, for an error a customer reads. */
function readableField(field: string): string {
  return field.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}
