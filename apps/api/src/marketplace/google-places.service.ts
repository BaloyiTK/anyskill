import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

type GooglePlacePrediction = {
  placeId?: string;
  text?: { text?: string };
};

@Injectable()
export class GooglePlacesService {
  private readonly placesUrl = "https://places.googleapis.com/v1";
  private readonly geocodingUrl = "https://maps.googleapis.com/maps/api/geocode/json";

  private get apiKey(): string {
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    if (!key) {
      throw new ServiceUnavailableException("Google Places is not configured on the AnySkill API.");
    }
    return key;
  }

  private validateSessionToken(token: string): string {
    if (!token || token.length > 36 || !/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new BadRequestException("A valid Google Places session token is required.");
    }
    return token;
  }

  async autocomplete(input: string, sessionToken: string, latitude?: string, longitude?: string) {
    const query = (input ?? "").trim();
    if (query.length < 3 || query.length > 200) {
      throw new BadRequestException("Location search must contain between 3 and 200 characters.");
    }
    const token = this.validateSessionToken(sessionToken);
    const body: Record<string, unknown> = {
      input: query,
      sessionToken: token,
      languageCode: "en",
      regionCode: "ZA",
      includedRegionCodes: ["za"],
    };
    // Keep autocomplete focused on South Africa. Do not apply a GPS-radius bias:
    // approximate device coordinates can otherwise push valid local street matches
    // out of the suggestion list.

    const response = await fetch(`${this.placesUrl}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new BadGatewayException("Google Places location search failed.");
    const payload = await response.json() as {
      suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
    };
    const suggestions = (payload.suggestions ?? []).flatMap((item) => {
      const prediction = item.placePrediction;
      const placeId = prediction?.placeId;
      const label = prediction?.text?.text;
      return placeId && label ? [{ placeId, label }] : [];
    }).slice(0, 5);
    return { suggestions };
  }

  async getPlaceDetails(placeId: string, sessionToken: string) {
    if (!placeId || placeId.length > 255 || /[\u0000-\u001F]/.test(placeId)) {
      throw new BadRequestException("A valid Google Place ID is required.");
    }
    const token = this.validateSessionToken(sessionToken);
    const response = await fetch(
      `${this.placesUrl}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(token)}`,
      {
        headers: {
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "id,formattedAddress,location",
        },
      },
    );
    if (!response.ok) throw new BadGatewayException("Google Places could not retrieve the selected location.");
    const payload = await response.json() as {
      id?: string;
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    const latitude = payload.location?.latitude;
    const longitude = payload.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new BadGatewayException("Google Places returned no coordinates for the selected location.");
    }
    return {
      placeId: payload.id ?? placeId,
      label: payload.formattedAddress ?? "Selected location",
      latitude,
      longitude,
    };
  }

  async reverseGeocode(latitudeValue: string, longitudeValue: string) {
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException("Valid latitude and longitude are required.");
    }
    const params = new URLSearchParams({
      latlng: `${latitude},${longitude}`,
      key: this.apiKey,
      language: "en",
    });
    const response = await fetch(`${this.geocodingUrl}?${params.toString()}`);
    if (!response.ok) throw new BadGatewayException("Google reverse geocoding failed.");
    const payload = await response.json() as {
      status?: string;
      results?: Array<{ formatted_address?: string }>;
    };
    if (payload.status === "REQUEST_DENIED" || payload.status === "OVER_QUERY_LIMIT" || payload.status === "UNKNOWN_ERROR") {
      throw new BadGatewayException("Google reverse geocoding is temporarily unavailable.");
    }
    return { label: payload.results?.[0]?.formatted_address ?? null };
  }
}
