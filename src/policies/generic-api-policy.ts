import type { Event, Policy } from '../types.ts';

/**
 * Moderation result from a generic moderation API.
 * 
 * Example: {"accept": true, "extra_data": null}, or {"accept": false}
 */
interface GenericModerationData {
  /**
   * Whether the content is accepted.
   */
  accept: boolean;
  /**
   * Additional information provided by the API, if any.
   */
  extra_data: string | null;
}

/**
 * Handler for generic API moderation.
 * The handler takes the event and the moderation result as arguments,
 * and returns `true` to **reject** the content, and `false` to accept.
 */
type GenericApiPolicyHandler = (event: Event, data: GenericModerationData) => boolean;

/**
 * Handler that rejects content if it's not accepted by the API.
 */
const genericFlaggedHandler: GenericApiPolicyHandler = (_, { accept }) => !accept;

/**
 * Policy options for `genericApiPolicy`.
 */
interface GenericApiPolicy {
  /**
   * Custom handler for the moderation result.
   * Defaults to `genericFlaggedHandler`.
   */
  handler?: GenericApiPolicyHandler;
  /**
   * URL of the moderation API.
   * Defaults to `http://localhost:3000/moderation`.
   */
  endpoint?: string;
  /**
   * API key for the moderation API.
   * Optional.
   */
  apiKey?: string;
  /**
   * Type of the action to take when the content is rejected.
   * Defaults to `'reject'`.
   */
  rejectType?: 'shadowReject' | 'reject';
  /**
   * Kinds of events to check.
   * Defaults to `[1]`.
   */
  kinds?: number[];

  /**
   * Duration in milliseconds before the request times out.
   * Defaults to `5000`.
   */
  timeout?: number;

  /**
   * Accept result on failure.
   * Defaults to `true`.
   */
  acceptOnFail?: boolean;
}

const DEFAULT_ENDPOINT = 'http://localhost:3000/moderation';

/**
 * Checks the moderation result from a generic API with a timeout.
 * @param endpoint URL of the moderation API
 * @param apiKey API key for the moderation API
 * @param event Event to check
 * @param timeout Duration in milliseconds before the request times out
 * @returns Moderation result
 */
async function checkModeration(endpoint: string, apiKey: string, event: Event, timeout: number = 5000, acceptOnFail = true, isMockTest = false): Promise<GenericModerationData> {
  // Create a timeout promise
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<GenericModerationData>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, timeout);
  });

  // Create a promise that wraps the fetch and JSON parsing
  const fetchAndParsePromise = new Promise<GenericModerationData>((resolve, reject) => {
    fetch(endpoint, {
      method: 'POST', // Specify the method as POST
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: event,
      }),
    })
      .then(resp => {
        // Check if the response is OK (status in the range 200-299)
        if (!resp.ok) {
          return reject(new Error(`HTTP error! status: ${resp.status}`));
        }

        // Parse the JSON response
        return resp.json();
      })
      .then(result => {
        resolve(result as GenericModerationData); // Ensure this matches the GenericModerationData type
      })
      .catch(error => {
        reject(error);
      });
  });

  try {
    // Race the fetch and parse promise against the timeout
    let result: GenericModerationData;

    if (!isMockTest) {
      result = await Promise.race([fetchAndParsePromise, timeoutPromise]);
    }
    else {
      result = await fetchAndParsePromise;
    }
    return result;
  } catch (_error) {
    return { accept: acceptOnFail, extra_data: null } as GenericModerationData; // Default result if there's an error
  }
  finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/**
 * Generic API policy.
 * Passes event content to a generic API and then rejects flagged events.
 * The handler is a custom function that takes the event and the moderation result as arguments,
 * and returns `true` to **reject** the content, and `false` to accept.
 */
const genericApiPolicy: Policy<GenericApiPolicy> = async ({ event }, opts = {}) => {
  const {
    handler = genericFlaggedHandler,
    endpoint = DEFAULT_ENDPOINT,
    apiKey = "",
    rejectType = 'reject',
    kinds = [1],
    timeout = 5000, // Default timeout of 5000ms
    acceptOnFail = true,
  } = opts;

  if (kinds.includes(event.kind)) {
    // Check moderation
    let result: GenericModerationData = { accept: acceptOnFail, extra_data: null };
    try {
      result = await checkModeration(endpoint, apiKey, event, timeout, acceptOnFail);
    } catch (_error) {
      // Do nothing since the default value will be used
      console.error(_error);
    }

    if (handler(event, result)) {
      return {
        id: event.id,
        action: rejectType,
        msg: rejectType === 'reject' ? 'blocked: content flagged by moderation tool.' : '',
      };
    }
  }

  return {
    id: event.id,
    action: 'accept',
    msg: '',
  };
};


export { genericFlaggedHandler, genericApiPolicy as default };

export type { GenericModerationData, GenericApiPolicy, GenericApiPolicyHandler };