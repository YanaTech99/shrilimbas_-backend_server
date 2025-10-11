# Porter API Integration Guide

## Overview

This system integrates with Porter API for real-time delivery tracking, similar to Zomato and Swiggy. Porter provides their own delivery partners, eliminating the need for a separate delivery boy app.

## Features

### 1. Real-time Tracking
- Live delivery partner location updates
- Estimated pickup and delivery times
- Turn-by-turn tracking for customers

### 2. Automated Notifications
- Order accepted notifications
- Order picked up notifications
- Out for delivery notifications
- Order delivered notifications

### 3. Webhook Integration
- Real-time status updates from Porter
- Automatic order status synchronization
- Delivery partner information updates

## Setup Instructions

### 1. Database Migration

Run the migration script to add Porter tracking fields:

```bash
mysql -u username -p database_name < migrations/add_porter_tracking_fields.sql
```

### 2. Environment Configuration

Add Porter API credentials to your `.env` file:

```env
# Porter API Configuration
PORTER_API_KEY=your_porter_api_key_here
PORTER_ENVIRONMENT=test  # or 'production'
PORTER_WEBHOOK_SECRET=your_webhook_secret_here
```

For multi-tenant setup, you can also use tenant-specific keys:

```env
PORTER_API_KEY_tenant1=tenant1_api_key
PORTER_API_KEY_tenant2=tenant2_api_key
```

### 3. Webhook Configuration

Configure Porter webhook URL in your Porter dashboard:

```
Webhook URL: https://yourdomain.com/api/v2/porter/webhook
Method: POST
```

The webhook will receive real-time updates about:
- Order acceptance
- Rider assignment
- Pickup confirmation
- Delivery status
- Location updates

## API Endpoints

### Customer Endpoints

#### 1. Get Order Tracking

```http
GET /api/v2/porter/tracking/:order_number
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "order_number": "ORD-1234567890",
    "status": "shipped",
    "tracking_url": "https://porter.in/track/...",
    "rider": {
      "name": "John Doe",
      "phone": "+919999999999",
      "current_location": {
        "latitude": 28.6139,
        "longitude": 77.2090
      }
    },
    "destination": {
      "address": "123 Main Street",
      "city": "Mumbai",
      "state": "Maharashtra",
      "coordinates": {
        "latitude": 19.0760,
        "longitude": 72.8777
      }
    },
    "timeline": {
      "pickup_time": "2025-01-15T10:30:00Z",
      "estimated_delivery": "2025-01-15T11:30:00Z",
      "actual_delivery": null
    },
    "status_history": [
      {
        "status": "pending",
        "description": "Order placed",
        "created_at": "2025-01-15T10:00:00Z"
      },
      {
        "status": "order_placed",
        "description": "Order accepted",
        "created_at": "2025-01-15T10:15:00Z"
      }
    ]
  }
}
```

#### 2. Get Live Rider Location

```http
GET /api/v2/porter/live-location/:order_number
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "latitude": 28.6139,
    "longitude": 77.2090,
    "timestamp": "2025-01-15T10:45:00Z",
    "message": "Live location"
  }
}
```

#### 3. Get Notifications

```http
GET /api/v2/porter/notifications?page=1&limit=20&unread_only=true
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "ORDER_SHIPPED",
      "title": "Order Picked Up",
      "message": "Your order #ORD-123 has been picked up and is on the way!",
      "order_id": 123,
      "is_read": false,
      "created_at": "2025-01-15T10:30:00Z",
      "metadata": {
        "order_number": "ORD-123",
        "rider_name": "John Doe",
        "tracking_url": "https://porter.in/track/..."
      }
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

#### 4. Mark Notification as Read

```http
PATCH /api/v2/porter/notifications/:notification_id/read
Authorization: Bearer <token>
```

#### 5. Mark All Notifications as Read

```http
PATCH /api/v2/porter/notifications/mark-all-read
Authorization: Bearer <token>
```

### Webhook Endpoint

```http
POST /api/v2/porter/webhook
Content-Type: application/json
```

This endpoint receives updates from Porter and automatically:
- Updates order status
- Stores rider location
- Sends notifications to customers and vendors
- Logs webhook events for audit

## Order Flow with Porter

### 1. Order Placement

When a customer places an order:

```javascript
POST /api/v2/orders/placeOrder
```

The system automatically:
1. Creates order in database
2. Generates invoice
3. Creates Porter delivery order
4. Stores Porter order ID and tracking URL
5. Sends "Order Placed" notification

### 2. Order Acceptance

Porter assigns a delivery partner and sends webhook:
- Updates order status to "order_placed"
- Stores rider information
- Sends "Order Accepted" notification

### 3. Order Pickup

When rider picks up the order:
- Updates order status to "shipped"
- Records pickup time
- Sends "Order Picked Up" notification
- Starts real-time location tracking

### 4. Out for Delivery

As rider moves towards destination:
- Continuously updates rider location
- Customers can track live location
- Provides ETA updates

### 5. Order Delivery

When order is delivered:
- Updates order status to "delivered"
- Records actual delivery time
- Sends "Order Delivered" notification
- Stores final delivery confirmation

## Status Mapping

Porter Status → Internal Status

- `open` → `pending`
- `accepted` → `order_placed`
- `rider_assigned` → `order_placed`
- `pickup_requested` → `order_placed`
- `picked_up` → `shipped`
- `out_for_delivery` → `shipped`
- `delivered` → `delivered`
- `cancelled` → `cancelled`
- `reopened` → `pending`

## Database Schema Changes

### Orders Table - New Fields

- `porter_order_id`: VARCHAR(255) - Porter's unique order ID
- `porter_tracking_url`: VARCHAR(512) - Public tracking URL
- `porter_rider_name`: VARCHAR(255) - Assigned rider name
- `porter_rider_phone`: VARCHAR(20) - Rider contact number
- `porter_rider_lat`: DECIMAL(10,7) - Real-time rider latitude
- `porter_rider_lng`: DECIMAL(10,7) - Real-time rider longitude
- `porter_status`: VARCHAR(50) - Porter's internal status
- `porter_webhook_data`: JSON - Raw webhook data

### New Table: porter_webhook_logs

Stores all webhook events for debugging and audit:

- `id`: Primary key
- `order_id`: Reference to orders table
- `porter_order_id`: Porter order ID
- `webhook_type`: Type of event
- `status`: Porter status
- `payload`: Complete webhook payload
- `processed`: Processing status
- `error_message`: Error details if any
- `created_at`: Timestamp

## Error Handling

The system handles Porter API errors gracefully:

1. If Porter API is unavailable during order creation:
   - Order is still created successfully
   - Marked for manual delivery assignment
   - Admin is notified

2. If webhook processing fails:
   - Event is logged in `porter_webhook_logs`
   - Error message is recorded
   - System can retry processing

3. If tracking data is unavailable:
   - Returns last known location
   - Indicates data staleness to user

## Testing

### Test Order Creation

```bash
curl -X POST https://yourdomain.com/api/v2/orders/placeOrder \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "delivery_address": "123 Test Street",
    "delivery_city": "Mumbai",
    "delivery_state": "Maharashtra",
    "delivery_country": "India",
    "delivery_postal_code": "400001",
    "delivery_latitude": 19.0760,
    "delivery_longitude": 72.8777,
    "items": [
      {
        "product_id": 1,
        "product_variant_id": 1,
        "quantity": 2
      }
    ],
    "payment_method": "cod"
  }'
```

### Test Webhook

```bash
curl -X POST https://yourdomain.com/api/v2/porter/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "ORD-1234567890",
    "status": "picked_up",
    "rider_name": "Test Rider",
    "rider_number": "+919999999999",
    "rider_lat": 19.0760,
    "rider_lng": 72.8777,
    "estimated_pickup_time": "2025-01-15T10:30:00Z",
    "estimated_drop_time": "2025-01-15T11:30:00Z"
  }'
```

## Do You Need a Delivery Boy App?

**No**, you don't need a separate delivery boy app because:

1. **Porter provides their own riders**: Porter has a network of delivery partners who use Porter's own app
2. **End-to-end solution**: Porter handles rider assignment, tracking, and delivery management
3. **Cost-effective**: No need to maintain a separate rider network
4. **Reliable service**: Porter's riders are trained and verified

Your system only needs:
- Customer app (to track orders)
- Vendor dashboard (to manage orders)
- Backend integration (already implemented)

## Monitoring and Maintenance

### Check Integration Health

```sql
-- Check recent Porter orders
SELECT
  order_number,
  porter_order_id,
  order_status,
  porter_rider_name,
  created_at
FROM orders
WHERE porter_order_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- Check webhook processing
SELECT
  porter_order_id,
  webhook_type,
  status,
  processed,
  error_message,
  created_at
FROM porter_webhook_logs
ORDER BY created_at DESC
LIMIT 20;

-- Check notification delivery
SELECT
  recipient_type,
  type,
  is_read,
  COUNT(*) as count
FROM notifications
WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY recipient_type, type, is_read;
```

## Support

For Porter API documentation and support:
- Porter Developer Portal: https://porter.in/developers
- Porter Support: support@porter.in
- API Status: https://status.porter.in

## Security Considerations

1. **API Key Security**: Store Porter API keys in environment variables, never in code
2. **Webhook Validation**: Validate webhook signatures to prevent spoofing
3. **Data Privacy**: Only expose necessary rider information to customers
4. **Rate Limiting**: Implement rate limiting on tracking endpoints
5. **HTTPS Only**: Always use HTTPS for webhook endpoints

## Troubleshooting

### Order not creating on Porter

- Check API key validity
- Verify pickup/delivery coordinates are valid
- Ensure Porter service is available in delivery area
- Check Porter API logs

### Webhooks not received

- Verify webhook URL is publicly accessible
- Check firewall rules
- Confirm webhook is configured in Porter dashboard
- Review webhook logs table

### Tracking not updating

- Check if webhooks are being received
- Verify webhook processing is successful
- Check network connectivity to Porter API
- Review error logs in `porter_webhook_logs`

## Next Steps

1. Configure Porter API credentials
2. Run database migration
3. Test order creation
4. Configure webhook URL in Porter dashboard
5. Test complete order flow
6. Monitor integration health
7. Set up alerting for failures

## Conclusion

This integration provides a complete real-time delivery tracking solution similar to Zomato and Swiggy, without requiring your own delivery boy app. Porter handles all delivery logistics while your system provides seamless tracking and notifications to customers and vendors.
