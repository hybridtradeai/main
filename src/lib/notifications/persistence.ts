import { supabaseServer } from '@lib/supabaseServer'

export async function createNotification(userId: string, type: string, title: string, message: string, link?: string) {
  if (!supabaseServer) return null
  const supabase = supabaseServer
  const data = { userId, type, title, message, link, read: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  
  const { data: n1, error: e1 } = await supabase.from('Notification').insert(data).select().single()
  
  if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
     const { data: n2 } = await supabase.from('notifications').insert({
         user_id: data.userId,
         type: data.type,
         title: data.title,
         message: data.message,
         link: data.link,
         read: false,
         created_at: data.createdAt,
         updated_at: data.updatedAt
     }).select().single()
     if (n2) return { ...n2, id: n2.id, userId: n2.user_id, createdAt: n2.created_at }
     return null
  }
  return n1
}

export async function createGlobalNotification(type: string, title: string, message: string) {
  if (!supabaseServer) return null
  const supabase = supabaseServer
  const data = { type, title, message, createdAt: new Date().toISOString() }
  const { data: g1, error: e1 } = await supabase.from('GlobalNotification').insert(data).select().single()
  
  if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
     const { data: g2 } = await supabase.from('global_notifications').insert({
         type: data.type,
         title: data.title,
         message: data.message,
         created_at: data.createdAt
     }).select().single()
     if (g2) return { ...g2, id: g2.id, createdAt: g2.created_at }
     return null
  }
  return g1
}

export async function deliverGlobalToUsers(globalId: string, userIds: string[]) {
  if (!userIds.length) return { count: 0 }
  if (!supabaseServer) return { count: 0 }
  const supabase = supabaseServer
  
  // Try PascalCase first
  // Note: Supabase insert many returns data, not count directly unless asked. 
  // We can just assume success if no error for bulk operations to save RTT or select count.
  
  const deliveries = userIds.map((userId) => ({ globalNotificationId: globalId, userId, deliveredAt: new Date().toISOString() }))
  
  const { error: e1, count: c1 } = await supabase.from('NotificationDelivery').insert(deliveries).select('id')
  
  if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
     const deliveriesLower = userIds.map((userId) => ({ global_notification_id: globalId, user_id: userId, delivered_at: new Date().toISOString() }))
     const { count: c2 } = await supabase.from('notification_deliveries').insert(deliveriesLower).select('id')
     return { count: c2 || deliveries.length }
  }
  
  return { count: c1 || deliveries.length }
}
