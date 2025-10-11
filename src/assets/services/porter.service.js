import axios from "axios";

const PORTER_BASE_URL = "https://pfe-apigw-uat.porter.in";

class PorterService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.axiosInstance = axios.create({
      baseURL: PORTER_BASE_URL,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
    });
  }

  async createOrder(orderData) {
    try {
      const {
        pickupDetails,
        dropDetails,
        customerId,
        orderNumber,
        itemDetails,
      } = orderData;

      const porterPayload = {
        request_id: orderNumber,
        delivery_instructions: {
          instructions_list: [
            {
              type: "text",
              description: dropDetails.instructions || "Handle with care",
            },
          ],
        },
        pickup_details: {
          address: {
            apartment_address: pickupDetails.address,
            street_address1: pickupDetails.address,
            street_address2: "",
            landmark: pickupDetails.landmark || "",
            city: pickupDetails.city,
            state: pickupDetails.state,
            pincode: pickupDetails.postal_code,
            country: pickupDetails.country,
            lat: parseFloat(pickupDetails.latitude),
            lng: parseFloat(pickupDetails.longitude),
          },
          contact_details: {
            name: pickupDetails.contact_name,
            phone_number: pickupDetails.phone_number,
          },
        },
        drop_details: {
          address: {
            apartment_address: dropDetails.address,
            street_address1: dropDetails.address,
            street_address2: "",
            landmark: dropDetails.landmark || "",
            city: dropDetails.city,
            state: dropDetails.state,
            pincode: dropDetails.postal_code,
            country: dropDetails.country,
            lat: parseFloat(dropDetails.latitude),
            lng: parseFloat(dropDetails.longitude),
          },
          contact_details: {
            name: dropDetails.contact_name,
            phone_number: dropDetails.phone_number,
          },
        },
        customer: {
          name: customerId,
          mobile: {
            country_code: "+91",
            number: dropDetails.phone_number,
          },
        },
        order_details: {
          order_value: itemDetails.order_value,
          order_type: "standard",
          items: itemDetails.items || [],
        },
      };

      const response = await this.axiosInstance.post(
        "/v1/orders/create",
        porterPayload
      );
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("Porter API Error:", error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  async getOrderTracking(orderNumber) {
    try {
      const response = await this.axiosInstance.get(
        `/v1/orders/${orderNumber}/track`
      );
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "Porter Tracking Error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  async cancelOrder(orderNumber, reason = "Customer request") {
    try {
      const response = await this.axiosInstance.post(
        `/v1/orders/${orderNumber}/cancel`,
        { reason }
      );
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "Porter Cancel Error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  async getDeliveryPartnerLocation(orderNumber) {
    try {
      const response = await this.axiosInstance.get(
        `/v1/orders/${orderNumber}/partner-location`
      );
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error(
        "Porter Location Error:",
        error.response?.data || error.message
      );
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  async getEstimatedFare(pickupLat, pickupLng, dropLat, dropLng) {
    try {
      const response = await this.axiosInstance.post("/v1/get_quote", {
        pickup_details: {
          lat: parseFloat(pickupLat),
          lng: parseFloat(pickupLng),
        },
        drop_details: {
          lat: parseFloat(dropLat),
          lng: parseFloat(dropLng),
        },
        customer: {
          mobile: {
            country_code: "+91",
            number: "9999999999",
          },
        },
      });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("Porter Quote Error:", error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }

  parseWebhookEvent(webhookData) {
    const {
      order_id,
      status,
      rider_name,
      rider_number,
      rider_lat,
      rider_lng,
      estimated_pickup_time,
      estimated_drop_time,
      actual_pickup_time,
      actual_drop_time,
    } = webhookData;

    return {
      order_number: order_id,
      status: this.mapPorterStatusToInternal(status),
      rider_details: {
        name: rider_name,
        phone: rider_number,
        latitude: rider_lat,
        longitude: rider_lng,
      },
      estimated_pickup_time,
      estimated_drop_time,
      actual_pickup_time,
      actual_drop_time,
      raw_data: webhookData,
    };
  }

  mapPorterStatusToInternal(porterStatus) {
    const statusMap = {
      open: "pending",
      accepted: "order_placed",
      rider_assigned: "order_placed",
      pickup_requested: "order_placed",
      picked_up: "shipped",
      out_for_delivery: "shipped",
      delivered: "delivered",
      cancelled: "cancelled",
      reopened: "pending",
    };

    return statusMap[porterStatus?.toLowerCase()] || "pending";
  }
}

export default PorterService;
