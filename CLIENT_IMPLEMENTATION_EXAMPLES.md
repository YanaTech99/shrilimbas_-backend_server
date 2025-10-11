# Client-Side Implementation Examples

## React/React Native Examples

### 1. Order Tracking Component

```javascript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const OrderTracking = ({ orderNumber, authToken }) => {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTracking();
    const interval = setInterval(fetchTracking, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [orderNumber]);

  const fetchTracking = async () => {
    try {
      const response = await axios.get(
        `/api/v2/porter/tracking/${orderNumber}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      setTracking(response.data.data);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (loading) return <div>Loading tracking information...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!tracking) return null;

  return (
    <div className="order-tracking">
      <h2>Order #{tracking.order_number}</h2>

      <div className="status">
        <span className={`badge ${tracking.status}`}>
          {tracking.status.replace('_', ' ').toUpperCase()}
        </span>
      </div>

      {tracking.rider && (
        <div className="rider-info">
          <h3>Delivery Partner</h3>
          <p><strong>Name:</strong> {tracking.rider.name}</p>
          <p><strong>Phone:</strong> {tracking.rider.phone}</p>
        </div>
      )}

      {tracking.timeline && (
        <div className="timeline">
          <h3>Delivery Timeline</h3>
          <p><strong>Picked up:</strong> {tracking.timeline.pickup_time || 'Pending'}</p>
          <p><strong>Estimated Delivery:</strong> {tracking.timeline.estimated_delivery || 'Calculating...'}</p>
          <p><strong>Actual Delivery:</strong> {tracking.timeline.actual_delivery || 'Not yet delivered'}</p>
        </div>
      )}

      <div className="status-history">
        <h3>Order History</h3>
        {tracking.status_history.map((status, index) => (
          <div key={index} className="status-item">
            <span className="status-name">{status.status}</span>
            <span className="status-time">{new Date(status.created_at).toLocaleString()}</span>
            <p>{status.description}</p>
          </div>
        ))}
      </div>

      {tracking.tracking_url && (
        <a href={tracking.tracking_url} target="_blank" rel="noopener noreferrer">
          View on Porter
        </a>
      )}
    </div>
  );
};

export default OrderTracking;
```

### 2. Live Map Tracking Component

```javascript
import React, { useState, useEffect } from 'react';
import { GoogleMap, Marker, Polyline } from '@react-google-maps/api';
import axios from 'axios';

const LiveMapTracking = ({ orderNumber, authToken }) => {
  const [riderLocation, setRiderLocation] = useState(null);
  const [destination, setDestination] = useState(null);
  const [tracking, setTracking] = useState(null);

  useEffect(() => {
    fetchInitialData();
    const interval = setInterval(updateRiderLocation, 15000); // Update every 15 seconds

    return () => clearInterval(interval);
  }, [orderNumber]);

  const fetchInitialData = async () => {
    try {
      const response = await axios.get(
        `/api/v2/porter/tracking/${orderNumber}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      const data = response.data.data;
      setTracking(data);
      setDestination({
        lat: data.destination.coordinates.latitude,
        lng: data.destination.coordinates.longitude
      });

      if (data.rider.current_location) {
        setRiderLocation({
          lat: data.rider.current_location.latitude,
          lng: data.rider.current_location.longitude
        });
      }
    } catch (err) {
      console.error('Failed to fetch tracking data:', err);
    }
  };

  const updateRiderLocation = async () => {
    try {
      const response = await axios.get(
        `/api/v2/porter/live-location/${orderNumber}`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      const data = response.data.data;
      setRiderLocation({
        lat: data.latitude,
        lng: data.longitude
      });
    } catch (err) {
      console.error('Failed to update rider location:', err);
    }
  };

  const mapCenter = riderLocation || destination || { lat: 0, lng: 0 };

  return (
    <div className="live-map-tracking">
      <div className="map-header">
        <h3>Live Tracking</h3>
        {tracking && (
          <div className="rider-info-compact">
            <span>{tracking.rider.name}</span>
            <span>{tracking.status}</span>
          </div>
        )}
      </div>

      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '400px' }}
        center={mapCenter}
        zoom={14}
      >
        {riderLocation && (
          <Marker
            position={riderLocation}
            icon={{
              url: '/icons/delivery-bike.png',
              scaledSize: { width: 40, height: 40 }
            }}
            title="Delivery Partner"
          />
        )}

        {destination && (
          <Marker
            position={destination}
            icon={{
              url: '/icons/destination-pin.png',
              scaledSize: { width: 30, height: 40 }
            }}
            title="Delivery Destination"
          />
        )}

        {riderLocation && destination && (
          <Polyline
            path={[riderLocation, destination]}
            options={{
              strokeColor: '#4285F4',
              strokeOpacity: 0.8,
              strokeWeight: 4
            }}
          />
        )}
      </GoogleMap>

      {tracking && tracking.timeline.estimated_delivery && (
        <div className="eta-info">
          <span>Estimated Arrival: {new Date(tracking.timeline.estimated_delivery).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
};

export default LiveMapTracking;
```

### 3. Notifications Component

```javascript
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const Notifications = ({ authToken }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  const fetchNotifications = async (unreadOnly = false) => {
    try {
      const response = await axios.get(
        `/api/v2/porter/notifications?unread_only=${unreadOnly}&limit=50`,
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      setNotifications(response.data.data);
      setUnreadCount(response.data.data.filter(n => !n.is_read).length);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId) => {
    try {
      await axios.patch(
        `/api/v2/porter/notifications/${notificationId}/read`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      setNotifications(prev =>
        prev.map(n =>
          n.id === notificationId ? { ...n, is_read: true } : n
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      await axios.patch(
        `/api/v2/porter/notifications/mark-all-read`,
        {},
        {
          headers: { Authorization: `Bearer ${authToken}` }
        }
      );

      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const getNotificationIcon = (type) => {
    const icons = {
      ORDER_PENDING: '📦',
      ORDER_ORDER_PLACED: '✅',
      ORDER_SHIPPED: '🚚',
      ORDER_DELIVERED: '✨',
      ORDER_CANCELLED: '❌'
    };
    return icons[type] || '📬';
  };

  if (loading) return <div>Loading notifications...</div>;

  return (
    <div className="notifications">
      <div className="notifications-header">
        <h3>Notifications</h3>
        {unreadCount > 0 && (
          <span className="unread-badge">{unreadCount}</span>
        )}
        {unreadCount > 0 && (
          <button onClick={markAllAsRead} className="mark-all-read">
            Mark all as read
          </button>
        )}
      </div>

      <div className="notifications-list">
        {notifications.length === 0 ? (
          <p className="no-notifications">No notifications yet</p>
        ) : (
          notifications.map(notification => (
            <div
              key={notification.id}
              className={`notification-item ${notification.is_read ? 'read' : 'unread'}`}
              onClick={() => !notification.is_read && markAsRead(notification.id)}
            >
              <div className="notification-icon">
                {getNotificationIcon(notification.type)}
              </div>
              <div className="notification-content">
                <h4>{notification.title}</h4>
                <p>{notification.message}</p>
                <span className="notification-time">
                  {new Date(notification.created_at).toLocaleString()}
                </span>
                {notification.metadata?.tracking_url && (
                  <a
                    href={notification.metadata.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="track-link"
                  >
                    Track Order
                  </a>
                )}
              </div>
              {!notification.is_read && (
                <div className="unread-indicator"></div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Notifications;
```

### 4. Complete Order Tracking Page

```javascript
import React from 'react';
import OrderTracking from './OrderTracking';
import LiveMapTracking from './LiveMapTracking';
import Notifications from './Notifications';

const OrderTrackingPage = ({ match }) => {
  const { orderNumber } = match.params;
  const authToken = localStorage.getItem('authToken'); // or from context/redux

  return (
    <div className="order-tracking-page">
      <div className="container">
        <h1>Track Your Order</h1>

        <div className="tracking-grid">
          <div className="tracking-main">
            <LiveMapTracking
              orderNumber={orderNumber}
              authToken={authToken}
            />

            <OrderTracking
              orderNumber={orderNumber}
              authToken={authToken}
            />
          </div>

          <div className="tracking-sidebar">
            <Notifications authToken={authToken} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderTrackingPage;
```

## Flutter Example

```dart
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:async';

class OrderTrackingScreen extends StatefulWidget {
  final String orderNumber;
  final String authToken;

  OrderTrackingScreen({required this.orderNumber, required this.authToken});

  @override
  _OrderTrackingScreenState createState() => _OrderTrackingScreenState();
}

class _OrderTrackingScreenState extends State<OrderTrackingScreen> {
  Map<String, dynamic>? trackingData;
  LatLng? riderLocation;
  LatLng? destination;
  Timer? _timer;
  GoogleMapController? _mapController;

  @override
  void initState() {
    super.initState();
    fetchTrackingData();
    _timer = Timer.periodic(Duration(seconds: 15), (timer) {
      updateRiderLocation();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> fetchTrackingData() async {
    try {
      final response = await http.get(
        Uri.parse('https://yourapi.com/api/v2/porter/tracking/${widget.orderNumber}'),
        headers: {
          'Authorization': 'Bearer ${widget.authToken}',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          trackingData = data['data'];

          if (trackingData?['rider']?['current_location'] != null) {
            riderLocation = LatLng(
              trackingData!['rider']['current_location']['latitude'],
              trackingData!['rider']['current_location']['longitude'],
            );
          }

          if (trackingData?['destination']?['coordinates'] != null) {
            destination = LatLng(
              trackingData!['destination']['coordinates']['latitude'],
              trackingData!['destination']['coordinates']['longitude'],
            );
          }
        });
      }
    } catch (e) {
      print('Error fetching tracking data: $e');
    }
  }

  Future<void> updateRiderLocation() async {
    try {
      final response = await http.get(
        Uri.parse('https://yourapi.com/api/v2/porter/live-location/${widget.orderNumber}'),
        headers: {
          'Authorization': 'Bearer ${widget.authToken}',
        },
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          riderLocation = LatLng(
            data['data']['latitude'],
            data['data']['longitude'],
          );
        });

        _mapController?.animateCamera(
          CameraUpdate.newLatLng(riderLocation!),
        );
      }
    } catch (e) {
      print('Error updating location: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Track Order'),
      ),
      body: trackingData == null
          ? Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              child: Column(
                children: [
                  Container(
                    height: 300,
                    child: GoogleMap(
                      initialCameraPosition: CameraPosition(
                        target: riderLocation ?? LatLng(0, 0),
                        zoom: 14,
                      ),
                      onMapCreated: (controller) {
                        _mapController = controller;
                      },
                      markers: {
                        if (riderLocation != null)
                          Marker(
                            markerId: MarkerId('rider'),
                            position: riderLocation!,
                            icon: BitmapDescriptor.defaultMarkerWithHue(
                              BitmapDescriptor.hueBlue,
                            ),
                            infoWindow: InfoWindow(
                              title: 'Delivery Partner',
                              snippet: trackingData?['rider']?['name'],
                            ),
                          ),
                        if (destination != null)
                          Marker(
                            markerId: MarkerId('destination'),
                            position: destination!,
                            icon: BitmapDescriptor.defaultMarkerWithHue(
                              BitmapDescriptor.hueRed,
                            ),
                            infoWindow: InfoWindow(
                              title: 'Delivery Destination',
                            ),
                          ),
                      },
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Order #${trackingData!['order_number']}',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        SizedBox(height: 8),
                        Chip(
                          label: Text(
                            trackingData!['status'].toString().toUpperCase(),
                          ),
                        ),
                        SizedBox(height: 16),
                        if (trackingData?['rider'] != null) ...[
                          Text(
                            'Delivery Partner',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(height: 8),
                          Text('Name: ${trackingData!['rider']['name']}'),
                          Text('Phone: ${trackingData!['rider']['phone']}'),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
```

## CSS Styles (React)

```css
/* Order Tracking Styles */
.order-tracking {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.status {
  margin: 20px 0;
}

.badge {
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: bold;
  text-transform: uppercase;
}

.badge.pending {
  background: #ffc107;
  color: #000;
}

.badge.order_placed {
  background: #2196f3;
  color: #fff;
}

.badge.shipped {
  background: #ff9800;
  color: #fff;
}

.badge.delivered {
  background: #4caf50;
  color: #fff;
}

.badge.cancelled {
  background: #f44336;
  color: #fff;
}

.rider-info, .timeline, .status-history {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 8px;
  margin: 16px 0;
}

.status-item {
  padding: 12px;
  border-left: 3px solid #2196f3;
  margin: 8px 0;
  background: white;
}

/* Live Map Tracking */
.live-map-tracking {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.map-header {
  background: #2196f3;
  color: white;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.eta-info {
  background: #f5f5f5;
  padding: 12px;
  text-align: center;
  font-weight: bold;
}

/* Notifications */
.notifications {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.notifications-header {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.unread-badge {
  background: #f44336;
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
}

.notification-item {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  gap: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.notification-item:hover {
  background: #f5f5f5;
}

.notification-item.unread {
  background: #e3f2fd;
}

.unread-indicator {
  width: 8px;
  height: 8px;
  background: #2196f3;
  border-radius: 50%;
  margin-left: auto;
}
```

This implementation provides a complete, production-ready client-side solution for tracking orders with Porter integration!
