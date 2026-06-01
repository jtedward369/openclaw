import type { ChannelApprovalNativePlannedTarget } from "./approval-native-delivery.js";
import type { ChannelApprovalKind } from "./approval-types.js";

/** Prepared channel-specific target paired with the route key used for send dedupe. */
export type PreparedChannelNativeApprovalTarget<TPreparedTarget> = {
  dedupeKey: string;
  target: TPreparedTarget;
};

/** Channel transport hooks used by the generic native approval runtime. */
export type ChannelNativeApprovalTransportSpec<
  TPendingEntry,
  TPreparedTarget,
  TPendingContent,
  TRequest,
> = {
  prepareTarget: (params: {
    plannedTarget: ChannelApprovalNativePlannedTarget;
    request: TRequest;
    approvalKind: ChannelApprovalKind;
    pendingContent: TPendingContent;
  }) =>
    | PreparedChannelNativeApprovalTarget<TPreparedTarget>
    | null
    | Promise<PreparedChannelNativeApprovalTarget<TPreparedTarget> | null>;
  deliverTarget: (params: {
    plannedTarget: ChannelApprovalNativePlannedTarget;
    preparedTarget: TPreparedTarget;
    request: TRequest;
    approvalKind: ChannelApprovalKind;
    pendingContent: TPendingContent;
  }) => TPendingEntry | null | Promise<TPendingEntry | null>;
};

/** Optional delivery lifecycle callbacks exposed to channel implementations. */
export type ChannelNativeApprovalDeliveryCallbacks<
  TPendingEntry,
  TPreparedTarget,
  TPendingContent,
  TRequest,
> = {
  onDeliveryError?: (params: {
    error: unknown;
    plannedTarget: ChannelApprovalNativePlannedTarget;
    request: TRequest;
    approvalKind: ChannelApprovalKind;
    pendingContent: TPendingContent;
  }) => void;
  onDuplicateSkipped?: (params: {
    plannedTarget: ChannelApprovalNativePlannedTarget;
    preparedTarget: PreparedChannelNativeApprovalTarget<TPreparedTarget>;
    request: TRequest;
    approvalKind: ChannelApprovalKind;
    pendingContent: TPendingContent;
  }) => void;
  onDelivered?: (params: {
    plannedTarget: ChannelApprovalNativePlannedTarget;
    preparedTarget: PreparedChannelNativeApprovalTarget<TPreparedTarget>;
    request: TRequest;
    approvalKind: ChannelApprovalKind;
    pendingContent: TPendingContent;
    entry: TPendingEntry;
  }) => void;
};
