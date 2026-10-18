import { getGetRoomQueryKey as roomKey, useGetRoom as useRoom, type RoomStatus } from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";

// Public identity isolates caches; the secret is read from per-participant storage
// by the transport and is never included in a query key or URL.
export const getGetRoomQueryKey = (code: string, id: string) => [...roomKey(code), id] as const;
export function useGetRoom(code: string, id: string, options: { query: UseQueryOptions<RoomStatus> }) {
  return useRoom(code, { ...options, request: { headers: { participantId: id } } });
}
