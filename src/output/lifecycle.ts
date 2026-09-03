/** Lifecycle fields exposed by Linear on historically listable resources. */
export interface LifecycleFields {
  archivedAt: string | null;
  trashed?: boolean;
}

/** A visible suffix for mixed live/historical tables. Trashed wins over archived. */
export function lifecycleSuffix(resource: LifecycleFields): string {
  return resource.trashed ? " (trashed)" : resource.archivedAt ? " (archived)" : "";
}
