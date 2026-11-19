export type WelcomeMapMarker = {
  id: string;
  coordinates: { latitude: number; longitude: number };
  title: string;
  snippet: string;
};

export type WelcomeMapProps = {
  center: { latitude: number; longitude: number };
  zoom: number;
  radiusKm: number;
  seekerLocation: { latitude: number; longitude: number } | null;
  markers: WelcomeMapMarker[];
  selectedMarkerId: string | null;
  onSelectMarker: (id: string | null) => void;
};
