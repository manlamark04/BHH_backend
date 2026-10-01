UPDATE bookings SET status = 'pending_payment' WHERE status = 'pending_approval';
UPDATE motor_rentals SET status = 'PENDING_PAYMENT' WHERE status = 'PENDING_APPROVAL';
UPDATE activity_rentals SET status = 'pending_payment' WHERE status = 'pending_approval';
UPDATE bills SET status = 'PENDING' WHERE status = 'PENDING_APPROVAL';
