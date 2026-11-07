import { z } from 'zod';

/** Public source summaries travel with the room's restaurant snapshot. */
export const restaurantFeedbackSchema = z.object({
  sourceLabel: z.string(),
  sourceUrl: z.string().url(),
  checkedAt: z.string(),
  publishedAt: z.string().optional(),
  summary: z.string(),
  caution: z.string().optional(),
  spiceNote: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
});
export type RestaurantFeedback = z.infer<typeof restaurantFeedbackSchema>;
