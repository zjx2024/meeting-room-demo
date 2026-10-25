export interface User {
  id: number;
  name: string;
  role: 'user' | 'super_admin';
}

export interface Room {
  id: number;
  name: string;
  capacity: number;
  equipment: string[];
  enabled: boolean;
}

export interface Reservation {
  id: number;
  room_id: number;
  room_name: string;
  booker_id: number;
  booker_name: string;
  subject: string;
  attendee_count: number;
  start_at: string;
  end_at: string;
  status: 'booked' | 'cancelled';
  status_label: '已预约' | '已取消';
}

export interface ReservationInput {
  room_id: number;
  subject: string;
  attendee_count: number;
  start_at: string;
  end_at: string;
}

export interface ApiResponse<T> { data: T; server_time: string }
export interface ApiError { error: { code: string; message: string; details?: unknown }; server_time: string }
