/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as authHelpers from "../authHelpers.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lessons from "../lessons.js";
import type * as pipeline from "../pipeline.js";
import type * as pipelineQueue from "../pipelineQueue.js";
import type * as profiles from "../profiles.js";
import type * as srs from "../srs.js";
import type * as streak from "../streak.js";
import type * as textSplit from "../textSplit.js";
import type * as vocab from "../vocab.js";
import type * as youtube from "../youtube.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  auth: typeof auth;
  authHelpers: typeof authHelpers;
  crons: typeof crons;
  http: typeof http;
  lessons: typeof lessons;
  pipeline: typeof pipeline;
  pipelineQueue: typeof pipelineQueue;
  profiles: typeof profiles;
  srs: typeof srs;
  streak: typeof streak;
  textSplit: typeof textSplit;
  vocab: typeof vocab;
  youtube: typeof youtube;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
