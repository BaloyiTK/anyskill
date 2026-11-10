import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
type CountryOption = { name: string; code: string; dialCode: string };
type AddressSuggestion = { label: string; latitude: number; longitude: number };
import { MapPinPicker } from "./MapPinPicker";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "./api";

type Section = "Profile" | "Verification" | "Skills" | "Portfolio" | "Submit";
type AccountType = "INDIVIDUAL" | "BUSINESS";
type MarketplaceRole = "SEEKER" | "PROVIDER";
type Payload = {
  profile: Record<string, string> & { marketplaceRoles?: MarketplaceRole[] };
  skills: Array<{ category: string; description: string; supportingDocuments: Array<{ name: string; url: string }> }>;
  portfolio: Array<{ title: string; description: string }>;
  percentage: number;
  sections: { profile: boolean; skills: boolean; portfolio: boolean };
};

const tabs: Section[] = ["Profile", "Verification", "Skills", "Portfolio", "Submit"];
const empty: Payload = { profile: {}, skills: [], portfolio: [], percentage: 0, sections: { profile: false, skills: false, portfolio: false } };
const colors = { ink: "#0B2545", muted: "#5D6D80", primary: "#0066CC", green: "#4CAF50", forest: "#1B5E20", border: "#DCE5EF", surface: "#FFFFFF", bg: "#F6F8FA", hero: "#0B2545", soft: "#EAF3FF" };

export function OnboardingScreen(p: { identityStatus: string; onBack: () => void; onStartVerification: () => void }) {
  const [active, setActive] = useState<Section>("Profile");
  const [data, setData] = useState<Payload>(empty);
  const [accountType, setAccountType] = useState<AccountType | "">("");
  const [marketplaceRoles, setMarketplaceRoles] = useState<MarketplaceRole[]>([]);
  const [profilePhotoUri, setProfilePhotoUri] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneDialCode, setPhoneDialCode] = useState("+27");
  const [phoneCountrySearch, setPhoneCountrySearch] = useState("");
  const [showPhoneCountries, setShowPhoneCountries] = useState(false);
  const [countries, setCountries] = useState<CountryOption[]>([{ name: "South Africa", code: "ZA", dialCode: "+27" }]);
  const [countrySearch, setCountrySearch] = useState("");
  const [showCountries, setShowCountries] = useState(false);
  const [country, setCountry] = useState("South Africa");
  const [countryCode, setCountryCode] = useState("ZA");
  const [regions, setRegions] = useState<string[]>([]);
  const [regionSearch, setRegionSearch] = useState("");
  const [showRegions, setShowRegions] = useState(false);
  const [regionsBusy, setRegionsBusy] = useState(false);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [suburb, setSuburb] = useState("");
  const [address, setAddress] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessCountry, setBusinessCountry] = useState("South Africa");
  const [businessProvince, setBusinessProvince] = useState("");
  const [businessCity, setBusinessCity] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactJobTitle, setContactJobTitle] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [identityStatus, setIdentityStatus] = useState(p.identityStatus);
  const [idDocumentReady, setIdDocumentReady] = useState(false);
  const [idType, setIdType] = useState<"SMART_ID_CARD" | "GREEN_ID_BOOK">("SMART_ID_CARD");
  const [idFrontReady, setIdFrontReady] = useState(false);
  const [idBackReady, setIdBackReady] = useState(false);
  const [bookPage1Ready, setBookPage1Ready] = useState(false);
  const [bookPage2Ready, setBookPage2Ready] = useState(false);
  const [selfieReady, setSelfieReady] = useState(false);
  const [identityPreviews, setIdentityPreviews] = useState<Record<string, string>>({});
  const [selfieCameraOpen, setSelfieCameraOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const selfieCameraRef = useRef<CameraView>(null);
  const [homeLatitude, setHomeLatitude] = useState("");
  const [homeLongitude, setHomeLongitude] = useState("");
  const [homeLocationBusy, setHomeLocationBusy] = useState(false);
  const [addressSearchBusy, setAddressSearchBusy] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [portfolioTitle, setPortfolioTitle] = useState("");
  const [portfolioDescription, setPortfolioDescription] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setBusy(true); setError("");
    try {
      const result = await apiRequest<Payload>("/profile/onboarding", {}, true);
      const home = await apiRequest<{homeLocationLabel:string|null;homeLatitude:number|null;homeLongitude:number|null}>("/profile/location/home", {}, true).catch(() => null);
      const verification = await apiRequest<{status:string;latestCase:{status:string}|null;idDocumentUploaded:boolean;idType:"SMART_ID_CARD"|"GREEN_ID_BOOK"|null;idFrontUploaded:boolean;idBackUploaded:boolean;bookPage1Uploaded:boolean;bookPage2Uploaded:boolean;selfieUploaded:boolean;previews?:Record<string,string|null>}>("/identity-verification/status", {}, true).catch(() => null);
      if (verification) { setIdentityStatus(verification.latestCase?.status ?? verification.status); if (verification.idType) setIdType(verification.idType); setIdentityPreviews(Object.fromEntries(Object.entries(verification.previews ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"))); setIdDocumentReady(verification.idDocumentUploaded); setIdFrontReady(verification.idFrontUploaded); setIdBackReady(verification.idBackUploaded); setBookPage1Ready(verification.bookPage1Uploaded); setBookPage2Ready(verification.bookPage2Uploaded); setSelfieReady(verification.selfieUploaded); }
      setData(result);
      const profile = result.profile ?? {};
      setAccountType(profile.accountType === "INDIVIDUAL" || profile.accountType === "BUSINESS" ? profile.accountType : "");
      setMarketplaceRoles(Array.isArray(profile.marketplaceRoles)
        ? profile.marketplaceRoles.filter((role: unknown): role is MarketplaceRole => role === "SEEKER" || role === "PROVIDER")
        : profile.marketplaceRole === "SEEKER" || profile.marketplaceRole === "PROVIDER" ? [profile.marketplaceRole] : []);
      setFirstName(profile.firstName ?? ""); setLastName(profile.lastName ?? ""); setPhone(profile.phone ?? "");
      setPhoneDialCode(profile.phoneDialCode ?? "+27");
      setCountry(profile.country ?? "South Africa"); setCountryCode(profile.countryCode ?? "ZA"); setProvince(profile.province ?? ""); setCity(profile.city ?? "");
      setSuburb(profile.suburb ?? ""); setAddress(profile.address ?? ""); setHouseNumber(profile.houseNumber ?? "");
      setBusinessName(profile.businessName ?? ""); setBusinessRegistrationNumber(profile.businessRegistrationNumber ?? "");
      setBusinessType(profile.businessType ?? ""); setBusinessEmail(profile.businessEmail ?? ""); setBusinessPhone(profile.businessPhone ?? "");
      setBusinessCountry(profile.businessCountry ?? "South Africa"); setBusinessProvince(profile.businessProvince ?? "");
      setBusinessCity(profile.businessCity ?? ""); setBusinessAddress(profile.businessAddress ?? "");
      setContactFirstName(profile.contactFirstName ?? ""); setContactLastName(profile.contactLastName ?? "");
      setContactJobTitle(profile.contactJobTitle ?? ""); setContactEmail(profile.contactEmail ?? ""); setContactPhone(profile.contactPhone ?? "");
      setHomeLatitude(home?.homeLatitude == null ? "" : String(home.homeLatitude));
      setHomeLongitude(home?.homeLongitude == null ? "" : String(home.homeLongitude));
      const skill = result.skills?.[0]; setCategory(skill?.category ?? ""); setDescription(skill?.description ?? "");
      const document = skill?.supportingDocuments?.[0]; setDocumentName(document?.name ?? ""); setDocumentUrl(document?.url ?? "");
      const item = result.portfolio?.[0]; setPortfolioTitle(item?.title ?? ""); setPortfolioDescription(item?.description ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your saved profile."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("https://restcountries.com/v3.1/all?fields=name,cca2,idd")
      .then((response) => { if (!response.ok) throw new Error("Country list unavailable"); return response.json(); })
      .then((items: Array<{ name?: { common?: string }; cca2?: string; idd?: { root?: string; suffixes?: string[] } }>) => {
        const parsed = items.map((item) => {
          const root = item.idd?.root ?? "";
          const suffix = item.idd?.suffixes?.length === 1 ? item.idd.suffixes[0] : "";
          return { name: item.name?.common ?? "", code: item.cca2 ?? "", dialCode: root + suffix };
        }).filter((item) => item.name && item.code && item.dialCode)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!cancelled && parsed.length) {
          setCountries(parsed);
          const selected = parsed.find((item) => item.code === countryCode || item.name === country) ?? parsed.find((item) => item.code === "ZA");
          if (selected) { setCountry(selected.name); setCountryCode(selected.code); }
        }
      })
      .catch(() => { /* Keep South Africa available as the offline-safe default. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRegions([]);
    if (!country) return;
    setRegionsBusy(true);
    fetch("https://countriesnow.space/api/v0.1/countries/states", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country }),
    })
      .then((response) => { if (!response.ok) throw new Error("Regions unavailable"); return response.json(); })
      .then((result: { data?: { states?: Array<{ name?: string }> } }) => {
        if (!cancelled) setRegions((result.data?.states ?? []).map((item) => item.name ?? "").filter(Boolean).sort());
      })
      .catch(() => { if (!cancelled) setRegions([]); })
      .finally(() => { if (!cancelled) setRegionsBusy(false); });
    return () => { cancelled = true; };
  }, [country]);

  const save = async (section: "profile" | "skills" | "portfolio"): Promise<boolean> => {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = section === "profile" ? { profile: {
        accountType, marketplaceRoles, firstName, lastName, phone, phoneDialCode, country, countryCode, province, city, suburb, address, houseNumber,
        businessName, businessRegistrationNumber, businessType, businessEmail, businessPhone, businessCountry, businessProvince, businessCity, businessAddress,
        contactFirstName, contactLastName, contactJobTitle, contactEmail, contactPhone,
      } }
        : section === "skills" ? { skills: category.trim() ? [{ category: category.trim(), description, supportingDocuments: documentName.trim() && documentUrl.trim() ? [{ name: documentName.trim(), url: documentUrl.trim() }] : [] }] : [] }
        : { portfolio: portfolioTitle.trim() ? [{ title: portfolioTitle.trim(), description: portfolioDescription }] : [] };
      const result = await apiRequest<Payload>("/profile/onboarding", { method: "PATCH", body: JSON.stringify(body) }, true);
      setData(result);
      if (section === "profile" && (homeLatitude.trim() || homeLongitude.trim())) {
        if (!homeLatitude.trim() || !homeLongitude.trim()) throw new Error("Choose both latitude and longitude for your Home Location.");
        if (!Number.isFinite(Number(homeLatitude)) || !Number.isFinite(Number(homeLongitude)) || Number(homeLatitude) < -90 || Number(homeLatitude) > 90 || Number(homeLongitude) < -180 || Number(homeLongitude) > 180) throw new Error("Enter valid Home Location coordinates.");
        await apiRequest("/profile/location/home", { method: "PATCH", body: JSON.stringify({ label: [address, suburb, city, province, country].filter(Boolean).join(", ") || "Saved Home Location", latitude: Number(homeLatitude), longitude: Number(homeLongitude) }) }, true);
      }
      setMessage("Your changes have been saved as a draft.");
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this section."); return false; }
    finally { setBusy(false); }
  };

  const chooseProfilePhoto = async () => {
    setError(""); setMessage("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Allow photo-library access to choose a profile picture, or continue with your initials.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setProfilePhotoUri(result.assets[0].uri);
      setMessage("Profile picture selected. This preview is local until profile-photo storage is connected.");
    }
  };

  const useCurrentHomeLocation = async () => {
    setHomeLocationBusy(true); setError(""); setMessage("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error("Location permission was not granted. You can search for or enter your home address manually.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setHomeLatitude(String(current.coords.latitude));
      setHomeLongitude(String(current.coords.longitude));
      const places = await Location.reverseGeocodeAsync({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      const place = places[0];
      if (place) {
        if (place.country) {
          setCountry(place.country);
          const matchedCountry = countries.find((item) => item.name.toLowerCase() === place.country?.toLowerCase());
          if (matchedCountry) setCountryCode(matchedCountry.code);
        }
        if (place.region) setProvince(place.region);
        if (place.city || place.subregion) setCity(place.city ?? place.subregion ?? "");
        if (place.district) setSuburb(place.district);
        const readable = [place.name, place.street, place.district, place.city ?? place.subregion, place.region, place.postalCode, place.country].filter(Boolean);
        if (readable.length) setAddress([...new Set(readable)].join(", "));
        setMessage("Your current address and map pin were added. Review the address, then save your profile.");
      } else {
        setMessage("Current map pin added. Add or search for a readable home address before saving.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read your current location."); }
    finally { setHomeLocationBusy(false); }
  };

  const searchHomeAddress = async (query: string) => {
    setAddress(query);
    if (query.trim().length < 3) { setAddressSuggestions([]); return; }
    setAddressSearchBusy(true);
    try {
      const response = await fetch("https://photon.komoot.io/api/?limit=10&lang=en&q=" + encodeURIComponent(query.trim() + ", " + country));
      if (!response.ok) throw new Error("Address search is temporarily unavailable.");
      const result = await response.json() as { features?: Array<{ properties?: { name?: string; street?: string; housenumber?: string; district?: string; city?: string; state?: string; country?: string; postcode?: string }; geometry?: { coordinates?: number[] } }> };
      const options: AddressSuggestion[] = (result.features ?? []).flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates;
        const longitude = coordinates?.[0];
        const latitude = coordinates?.[1];
        if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
        const props = feature.properties ?? {};
        const label = [props.street ?? props.name, props.district, props.city, props.state, props.postcode, props.country].filter(Boolean).join(", ");
        return label ? [{ label: [props.housenumber, label].filter(Boolean).join(" "), latitude, longitude }] : [];
      });
      setAddressSuggestions(options);
    } catch (e) {
      setAddressSuggestions([]);
      setError(e instanceof Error ? e.message : "Could not search for this address.");
    } finally { setAddressSearchBusy(false); }
  };

  const selectAddress = (item: AddressSuggestion) => {
    setAddress(item.label);
    setHomeLatitude(String(item.latitude));
    setHomeLongitude(String(item.longitude));
    setAddressSuggestions([]);
    setMessage("Address selected and map pin updated. You can fine-tune the pin on the map.");
  };

  const updatePin = async (latitude: number, longitude: number) => {
    setHomeLatitude(String(latitude));
    setHomeLongitude(String(longitude));
    try {
      const places = await Location.reverseGeocodeAsync({ latitude, longitude });
      const place = places[0];
      if (place) {
        const readable = [place.name, place.street, place.district, place.city ?? place.subregion, place.region, place.postalCode, place.country].filter(Boolean);
        if (readable.length) setAddress([...new Set(readable)].join(", "));
      }
    } catch { /* Keep the manually entered address if reverse geocoding is unavailable. */ }
  };


  const uploadIdentityAsset = async (purpose: "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE", uri: string, mimeType?: string | null, fileSize?: number | null, originalFileName?: string | null) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const contentType = mimeType ?? "image/jpeg";
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("Please use a JPEG, PNG or WebP image.");
      const blob = await (await fetch(uri)).blob();
      const fileName = originalFileName ?? (purpose === "ID_SELFIE" ? "identity-selfie.jpg" : purpose.toLowerCase().replaceAll("_", "-") + ".jpg");
      const reservation = await apiRequest<{assetId:string;cloudName:string;apiKey:string;timestamp:number;signature:string;publicId:string;assetFolder:string}>("/identity-verification/uploads", { method: "POST", body: JSON.stringify({ fileName, contentType, sizeBytes: fileSize ?? blob.size, purpose }) }, true);
      const form = new FormData();
      form.append("file", blob, fileName); form.append("api_key", reservation.apiKey); form.append("timestamp", String(reservation.timestamp)); form.append("signature", reservation.signature); form.append("public_id", reservation.publicId); form.append("asset_folder", reservation.assetFolder); form.append("overwrite", "false"); form.append("unique_filename", "false"); form.append("use_filename", "false");
      const response = await fetch("https://api.cloudinary.com/v1_1/" + reservation.cloudName + "/image/authenticated/upload", { method: "POST", body: form });
      if (!response.ok) throw new Error("Secure image upload failed. Please try again.");
      await apiRequest("/identity-verification/uploads/confirm", { method: "POST", body: JSON.stringify({ assetId: reservation.assetId }) }, true);
      setIdentityPreviews((current) => ({ ...current, [purpose]: uri }));
      if (purpose === "ID_DOCUMENT_FRONT") setIdFrontReady(true);
      if (purpose === "ID_DOCUMENT_BACK") setIdBackReady(true);
      if (purpose === "ID_BOOK_PAGE_1") setBookPage1Ready(true);
      if (purpose === "ID_BOOK_PAGE_2") setBookPage2Ready(true);
      if (purpose === "ID_SELFIE") setSelfieReady(true);
      setIdDocumentReady(idType === "SMART_ID_CARD" ? (purpose === "ID_DOCUMENT_FRONT" || idFrontReady) && (purpose === "ID_DOCUMENT_BACK" || idBackReady) : (purpose === "ID_BOOK_PAGE_1" || bookPage1Ready) && (purpose === "ID_BOOK_PAGE_2" || bookPage2Ready));
      setMessage(purpose === "ID_SELFIE" ? "Live selfie captured and uploaded securely." : "ID image uploaded securely.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not upload verification image."); }
    finally { setBusy(false); }
  };

  const uploadIdentityImage = async (purpose: "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2", source: "camera" | "gallery" = "camera") => {
    try {
      const picked = source === "gallery"
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 })
        : await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85, cameraType: ImagePicker.CameraType.back });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      await uploadIdentityAsset(purpose, asset.uri, asset.mimeType, asset.fileSize, asset.fileName);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not select the ID image."); }
  };

  const openSelfieCamera = async () => {
    setError(""); setMessage("");
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) { setError("Camera permission is required to take your live selfie."); return; }
    }
    setSelfieCameraOpen(true);
  };

  const captureSelfie = async () => {
    if (!selfieCameraRef.current) { setError("The front camera is not ready yet. Please try again."); return; }
    setBusy(true); setError("");
    try {
      const photo = await selfieCameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) throw new Error("The selfie could not be captured. Please try again.");
      setSelfieCameraOpen(false);
      await uploadIdentityAsset("ID_SELFIE", photo.uri, "image/jpeg", undefined, "identity-selfie.jpg");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not capture your selfie.");
      setBusy(false);
    }
  };

  const submitIdentityVerification = async () => {
    const idComplete = idType === "SMART_ID_CARD" ? idFrontReady && idBackReady : bookPage1Ready && bookPage2Ready;
    if (!idComplete || !selfieReady) { setError("Complete both required ID images and take a live selfie before continuing."); return false; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{status:string;message?:string}>("/identity-verification/submit", { method: "POST", body: JSON.stringify({ idType }) }, true);
      setIdentityStatus(result.status); setMessage(result.message ?? "Your identity documents were submitted for administrator review."); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit identity verification."); return false; }
    finally { setBusy(false); }
  };

  const saveCurrent = async () => {
    if (active === "Profile") return save("profile");
    if (active === "Skills") return save("skills");
    if (active === "Portfolio") return save("portfolio");
    if (active === "Verification") { setMessage("Uploaded verification images are saved securely."); return true; }
    if (!await save("profile") || !await save("skills")) return false;
    return save("portfolio");
  };

  const continueCurrent = async () => {
    if (active === "Profile") {
      if (!accountType) { setError("Choose Individual or Business before continuing."); return; }
      if (marketplaceRoles.length === 0) { setError("Select Skill Seeker, Skill Provider, or both before continuing."); return; }
      if (await save("profile")) setActive("Verification");
      return;
    }
    if (active === "Verification") { if (await submitIdentityVerification()) setActive("Skills"); return; }
    if (active === "Skills") { if (await save("skills")) setActive("Portfolio"); return; }
    if (active === "Portfolio") { if (await save("portfolio")) setActive("Submit"); return; }
    if (await saveCurrent()) await submit();
  };
  const submit = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/profile/onboarding/submit", { method: "POST", body: "{}" }, true);
      setMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your available information."); }
    finally { setBusy(false); }
  };

  const status = (key: "profile" | "skills" | "portfolio") => data.sections?.[key] ? "Complete" : "Draft / not complete";
  const Field = (label: string, value: string, change: (v: string) => void, multiline = false) => (
    <View style={st.field} key={label}><Text style={st.label}>{label}</Text><TextInput value={value} onChangeText={change} multiline={multiline} placeholder={label} placeholderTextColor="#93A099" style={[st.input, multiline && st.multiline]} /></View>
  );

  return <View style={st.container}>
    <View style={st.hero}>
      <View style={st.heroTop}>
        <Text style={st.brand}>anyskill<Text style={st.brandAccent}>.</Text></Text>
        <Pressable onPress={p.onBack} accessibilityRole="button" style={st.backButton}><Text style={st.back}>Back</Text></Pressable>
      </View>
      <Text style={st.heroTitle}>Let's build your profile.</Text>
      <Text style={st.heroSubtitle}>Tell us a little about yourself so we can create the right AnySkill experience.</Text>
    </View>
    <View style={st.progressWrap}>
      <View style={st.progressMeta}>
        <View><Text style={st.stepCount}>Step {tabs.indexOf(active) + 1} of 5</Text><Text style={st.percent}>{active} information</Text></View>
        <Text style={st.percentStrong}>{data.percentage}% complete</Text>
      </View>
      <View style={st.track}><View style={[st.fill, { width: `${data.percentage}%` }]} /></View>
      <View style={st.tabs}>
        {tabs.map((tab, index) => <Pressable key={tab} onPress={() => setActive(tab)} style={[st.tab, active === tab && st.activeTab, tabs.indexOf(active) > index && st.doneTab]}><View style={[st.stepDot, active === tab && st.activeDot, tabs.indexOf(active) > index && st.doneDot]}><Text style={[st.stepDotText, (active === tab || tabs.indexOf(active) > index) && st.activeDotText]}>{tabs.indexOf(active) > index ? "✓" : index + 1}</Text></View><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[st.tabText, active === tab && st.activeTabText]}>{tab}</Text></Pressable>)}
      </View>
    </View>
    <ScrollView style={st.body} contentContainerStyle={{ paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      {busy && <ActivityIndicator color={colors.primary} />}
      {active === "Profile" && <>
        <Text style={st.heading}>Set up your profile</Text>
        <View style={st.photoCard}>
          <View style={st.avatar}>
            {profilePhotoUri ? <Image source={{ uri: profilePhotoUri }} style={st.avatarImage} /> : <Text style={st.avatarInitials}>{[firstName.trim()[0], lastName.trim()[0]].filter(Boolean).join("").toUpperCase() || "AS"}</Text>}
          </View>
          <View style={st.photoCopy}>
            <Text style={st.photoTitle}>Profile picture</Text>
            <Text style={st.photoHelp}>Use your Google photo when available, or add a picture from your device. You can continue with your initials.</Text>
            <Pressable onPress={() => void chooseProfilePhoto()} style={st.photoButton}><Text style={st.photoButtonText}>{profilePhotoUri ? "Change picture" : "Upload picture"}</Text></Pressable>
          </View>
        </View>
        <Text style={st.help}>First choose whether this profile represents you as an individual or a business, then choose how you want to participate in AnySkill. You can save a draft and finish later.</Text>
        <Text style={st.label}>Account type</Text>
        <View style={st.choiceRow}>
          <Choice label="Individual" description="A personal profile" selected={accountType === "INDIVIDUAL"} onPress={() => setAccountType("INDIVIDUAL")} />
          <Choice label="Business" description="A company or organisation" selected={accountType === "BUSINESS"} onPress={() => setAccountType("BUSINESS")} />
        </View>
        <Text style={st.label}>How will you use AnySkill?</Text>
        <Text style={st.help}>Select one or both. You can change this later.</Text>
        <View style={st.choiceRow}>
          <RoleChoice label="Skill Seeker" description="Find and hire service providers." selected={marketplaceRoles.includes("SEEKER")} onPress={() => setMarketplaceRoles((current) => current.includes("SEEKER") ? current.filter((role) => role !== "SEEKER") : [...current, "SEEKER"])} />
          <RoleChoice label="Skill Provider" description="Offer your skills and services." selected={marketplaceRoles.includes("PROVIDER")} onPress={() => setMarketplaceRoles((current) => current.includes("PROVIDER") ? current.filter((role) => role !== "PROVIDER") : [...current, "PROVIDER"])} />
        </View>
        <Text style={st.roleHelp}>{marketplaceRoles.length === 0 ? "Select at least one role to continue." : "Selected: " + marketplaceRoles.map((role) => role === "SEEKER" ? "Skill Seeker" : "Skill Provider").join(" + ")}</Text>
        {accountType === "BUSINESS" ? <>
          <Text style={st.sectionHeading}>Business information</Text>
          {Field("Business name", businessName, setBusinessName)}
          {Field("Business registration number (optional)", businessRegistrationNumber, setBusinessRegistrationNumber)}
          {Field("Business type", businessType, setBusinessType)}
          {Field("Business email address", businessEmail, setBusinessEmail)}
          {Field("Business contact number", businessPhone, setBusinessPhone)}
          {Field("Business country", businessCountry, setBusinessCountry)}
          {Field("Business province / state", businessProvince, setBusinessProvince)}
          {Field("Business city", businessCity, setBusinessCity)}
          {Field("Business physical address", businessAddress, setBusinessAddress)}
          <Text style={st.sectionHeading}>Authorised contact person</Text>
          <Text style={st.help}>Who should AnySkill contact about this business account?</Text>
          {Field("Contact person's first name", contactFirstName, setContactFirstName)}
          {Field("Contact person's last name", contactLastName, setContactLastName)}
          {Field("Position / job title", contactJobTitle, setContactJobTitle)}
          {Field("Contact person's email address", contactEmail, setContactEmail)}
          {Field("Contact person's phone number", contactPhone, setContactPhone)}
          <Text style={st.help}>The contact person will complete identity verification in the next step.</Text>
        </> : <>
          {Field("First name", firstName, setFirstName)}{Field("Last name", lastName, setLastName)}
        <Text style={st.label}>Contact number</Text>
        <View style={st.inlineFields}>
          <View style={st.codeField}>
            <Pressable style={st.selectInput} onPress={() => setShowPhoneCountries((value) => !value)}><Text style={st.selectText}>{phoneDialCode} ▾</Text></Pressable>
          </View>
          <View style={st.phoneField}><TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor="#93A099" style={st.input} /></View>
        </View>
        {showPhoneCountries && <View style={st.optionPanel}>
          <TextInput value={phoneCountrySearch} onChangeText={setPhoneCountrySearch} placeholder="Search calling code or country" style={st.searchInput} />
          {countries.filter((item) => (item.name + " " + item.dialCode).toLowerCase().includes(phoneCountrySearch.toLowerCase())).slice(0, 12).map((item) =>
            <Pressable key={item.code} style={st.option} onPress={() => { setPhoneDialCode(item.dialCode); setShowPhoneCountries(false); setPhoneCountrySearch(""); }}>
              <Text style={st.optionText}>{item.name} ({item.dialCode})</Text>
            </Pressable>)}
        </View>}
        <Text style={st.label}>Country</Text>
        <Pressable style={st.selectInput} onPress={() => setShowCountries((value) => !value)}><Text style={st.selectText}>{country} ▾</Text></Pressable>
        {showCountries && <View style={st.optionPanel}>
          <TextInput value={countrySearch} onChangeText={setCountrySearch} placeholder="Search country" style={st.searchInput} />
          {countries.filter((item) => item.name.toLowerCase().includes(countrySearch.toLowerCase())).slice(0, 14).map((item) =>
            <Pressable key={item.code} style={st.option} onPress={() => { setCountry(item.name); setCountryCode(item.code); setProvince(""); setShowCountries(false); setCountrySearch(""); }}>
              <Text style={st.optionText}>{item.name}</Text>
            </Pressable>)}
        </View>}
        <Text style={st.label}>Province / State</Text>
        <Pressable style={st.selectInput} onPress={() => setShowRegions((value) => !value)}><Text style={st.selectText}>{regionsBusy ? "Loading regions..." : province || "Select province / state"} ▾</Text></Pressable>
        {showRegions && <View style={st.optionPanel}>
          <TextInput value={regionSearch} onChangeText={setRegionSearch} placeholder="Search province / state" style={st.searchInput} />
          {regions.filter((item) => item.toLowerCase().includes(regionSearch.toLowerCase())).slice(0, 14).map((item) =>
            <Pressable key={item} style={st.option} onPress={() => { setProvince(item); setShowRegions(false); setRegionSearch(""); }}>
              <Text style={st.optionText}>{item}</Text>
            </Pressable>)}
          {!regionsBusy && regions.length === 0 && <Text style={st.optionHint}>No region list available for this country. You can type it below.</Text>}
        </View>}
        {Field("Province / State (manual entry)", province, setProvince)}
        {Field("City", city, setCity)}{Field("Suburb / District", suburb, setSuburb)}
        {Field("House / Building number", houseNumber, setHouseNumber)}
        <Text style={st.label}>Search home address</Text>
        <TextInput value={address} onChangeText={(value) => void searchHomeAddress(value)} placeholder="Start typing street, suburb or postcode" placeholderTextColor="#93A099" style={st.input} />
        {addressSearchBusy && <ActivityIndicator color={colors.primary} />}
        {addressSuggestions.length > 0 && <View style={st.optionPanel}>
          {addressSuggestions.map((item, index) => <Pressable key={item.label + index} style={st.option} onPress={() => selectAddress(item)}>
            <Text style={st.optionText}>{item.label}</Text>
          </Pressable>)}
        </View>}
        <Action label={homeLocationBusy ? "Getting location..." : "Use current GPS for Home Location"} onPress={() => void useCurrentHomeLocation()} disabled={busy || homeLocationBusy} />
        <Text style={st.help}>Search includes your selected country. Some map records only contain street names; enter the house or building number above when it is missing. Review the address and adjust the pin.</Text>
        <Text style={st.label}>Choose Home Location on the map</Text>
        <MapPinPicker latitude={homeLatitude.trim() && Number.isFinite(Number(homeLatitude)) ? Number(homeLatitude) : -26.2041} longitude={homeLongitude.trim() && Number.isFinite(Number(homeLongitude)) ? Number(homeLongitude) : 28.0473} selectedLatitude={homeLatitude.trim() ? Number(homeLatitude) : null} selectedLongitude={homeLongitude.trim() ? Number(homeLongitude) : null} onSelect={(lat, lon) => { void updatePin(lat, lon); }} />
        {Field("Home latitude", homeLatitude, setHomeLatitude)}{Field("Home longitude", homeLongitude, setHomeLongitude)}
        <Text style={st.help}>Home Location is saved to your profile and used as a default. It is not continuous live tracking. You can also type coordinates if map tiles are unavailable.</Text>
        </>}
        <Text style={st.status}>Section: {status("profile")}</Text>
      </>}
      {active === "Verification" && <>
        <Text style={st.heading}>Identity verification</Text>
        <Text style={st.help}>Identity verification is separate from profile completion. You may continue building your profile, but verification is required before restricted marketplace actions.</Text>
        <View style={st.card}><Text style={st.label}>Current identity status</Text><Text style={st.statusValue}>{identityStatus.replace(/_/g, " ")}</Text></View>
        <Text style={st.label}>1. Choose your South African ID type</Text>
        <View style={st.choiceRow}>
          <Choice label="Smart ID card" description="Front and back of the card" selected={idType === "SMART_ID_CARD"} onPress={() => setIdType("SMART_ID_CARD")} />
          <Choice label="Green ID book" description="Required identity pages" selected={idType === "GREEN_ID_BOOK"} onPress={() => setIdType("GREEN_ID_BOOK")} />
        </View>
        <Text style={st.help}>For each ID image, choose whether to upload an existing picture or take a new picture with your camera. Images must be clear, readable and no larger than 10 MB.</Text>
        {(idType === "SMART_ID_CARD" ? [
          { purpose: "ID_DOCUMENT_FRONT" as const, label: "Front of Smart ID card", ready: idFrontReady },
          { purpose: "ID_DOCUMENT_BACK" as const, label: "Back of Smart ID card", ready: idBackReady },
        ] : [
          { purpose: "ID_BOOK_PAGE_1" as const, label: "ID book: photo/details page", ready: bookPage1Ready },
          { purpose: "ID_BOOK_PAGE_2" as const, label: "ID book: second identity page", ready: bookPage2Ready },
        ]).map((item) => <View key={item.purpose} style={st.card}>
          <Text style={st.label}>{item.label}</Text>
          {identityPreviews[item.purpose] ? <Image source={{ uri: identityPreviews[item.purpose] }} style={st.imagePreview} resizeMode="contain" /> : null}
          <Text style={st.status}>{item.ready ? "Image saved securely" : "Image required"}</Text>
          <View style={st.choiceRow}>
            <View style={{ flex: 1 }}><Action label="Upload from gallery" onPress={() => void uploadIdentityImage(item.purpose, "gallery")} disabled={busy} /></View>
            <View style={{ flex: 1 }}><Action label="Take picture" onPress={() => void uploadIdentityImage(item.purpose, "camera")} disabled={busy} /></View>
          </View>
        </View>)}
        <Text style={st.label}>2. Live selfie</Text>
        <Text style={st.help}>Your front-facing camera will open. Take a fresh selfie now; selecting a selfie from your gallery is not allowed.</Text>
        {selfieCameraOpen ? <View style={st.cameraFrame}>
          <CameraView ref={selfieCameraRef} style={StyleSheet.absoluteFill} facing="front" />
          <View pointerEvents="none" style={st.cameraOverlay}>
            <Text style={st.cameraHint}>Position your face inside the oval</Text>
            <View style={st.headGuide} />
            <Text style={st.cameraHint}>Keep your head straight and look at the camera</Text>
          </View>
          <View style={st.cameraControls}>
            <Pressable style={[st.cameraButton, st.cameraCancel]} onPress={() => setSelfieCameraOpen(false)} disabled={busy}><Text style={st.cameraButtonText}>Cancel</Text></Pressable>
            <Pressable style={st.cameraButton} onPress={() => void captureSelfie()} disabled={busy}><Text style={st.cameraButtonText}>{busy ? "Please wait..." : "Take selfie"}</Text></Pressable>
          </View>
        </View> : <Action label={selfieReady ? "Retake live selfie" : "Open front camera and take selfie"} onPress={() => void openSelfieCamera()} disabled={busy} />}
        {identityPreviews.ID_SELFIE ? <Image source={{ uri: identityPreviews.ID_SELFIE }} style={st.imagePreview} resizeMode="contain" /> : null}
        <Text style={st.status}>{selfieReady ? "Live selfie captured and uploaded" : "Live selfie required"}</Text>
        <Text style={st.help}>Images are stored privately. An administrator will review them later; uploading does not automatically verify your identity.</Text>
      </>}
      {active === "Skills" && <>
        <Text style={st.heading}>Skills and experience</Text><Text style={st.help}>Add each skill and attach its supporting documents to that skill. You can skip this section and complete it later.</Text>
        {Field("Skill category", category, setCategory)}{Field("Experience and service description", description, setDescription, true)}
        {Field("Supporting document name", documentName, setDocumentName)}{Field("Supporting document URL (temporary)", documentUrl, setDocumentUrl)}
        <Text style={st.help}>Document upload to AnySkill-managed cloud storage will be connected separately; this field currently records a document reference only.</Text>
        <Text style={st.status}>Section: {status("skills")}</Text>
      </>}
      {active === "Portfolio" && <>
        <Text style={st.heading}>Portfolio</Text><Text style={st.help}>Add examples of previous work. This section is optional and can be completed later.</Text>
        {Field("Project or work title", portfolioTitle, setPortfolioTitle)}{Field("Description", portfolioDescription, setPortfolioDescription, true)}
        <Text style={st.status}>Section: {status("portfolio")}</Text>
      </>}
      {active === "Submit" && <>
        <Text style={st.heading}>Review and submit</Text><Text style={st.help}>Submitting saves the information currently available. It does not make your profile mandatory or grant identity-verified permissions. You can edit drafts later.</Text>
        <View style={st.card}><Text style={st.status}>Profile: {status("profile")}</Text><Text style={st.status}>Skills: {status("skills")}</Text><Text style={st.status}>Portfolio: {status("portfolio")}</Text><Text style={st.status}>Identity: {identityStatus.replace(/_/g, " ")}</Text></View>

      </>}
      {!!message && <Text style={st.success}>{message}</Text>}
      {!!error && <Text style={st.error}>{error}</Text>}
      <View style={st.saveButtons}>
        <View style={st.saveButtonHalf}><Action label="Save" onPress={() => void saveCurrent()} disabled={busy} /></View>
        <View style={st.saveButtonHalf}><Action label="Save & Continue" onPress={() => void continueCurrent()} disabled={busy} /></View>
      </View>
    </ScrollView>
  </View>;
}

function Action(p: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={p.onPress} disabled={p.disabled} style={[st.action, p.disabled && { opacity: 0.45 }]}><Text style={st.actionText}>{p.label}</Text></Pressable>;
}
function Choice(p: { label: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: p.selected }} onPress={p.onPress} style={[st.choice, p.selected && st.choiceSelected]}>
    <View style={st.choiceTop}>
      <Text style={st.choiceTitle}>{p.label}</Text>
      <View style={[st.choiceRadio, p.selected && st.choiceRadioSelected]} />
    </View>
    <Text style={st.choiceDescription}>{p.description}</Text>
  </Pressable>;
}
function RoleChoice(p: { label: string; description: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: p.selected }} onPress={p.onPress} style={[st.choice, st.roleChoice, p.selected && st.choiceSelected]}>
    <View style={st.choiceTop}>
      <Text style={st.choiceTitle}>{p.label}</Text>
      <View style={[st.roleCheck, p.selected && st.roleCheckSelected]}>{p.selected ? <Text style={st.roleCheckText}>✓</Text> : null}</View>
    </View>
    <Text style={st.choiceDescription}>{p.description}</Text>
  </Pressable>;
}
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.hero, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 25, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 25 },
  brand: { color: "#FFFFFF", fontSize: 19, fontWeight: "900", letterSpacing: 0.2 }, brandAccent: { color: colors.green },
  backButton: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: "#263655" }, back: { color: "#E3EAFF", fontSize: 12, fontWeight: "800" },
  heroTitle: { color: "#FFFFFF", fontSize: 26, lineHeight: 32, fontWeight: "900", letterSpacing: -0.6 },
  heroSubtitle: { color: "#C3CDE0", fontSize: 13, lineHeight: 19, marginTop: 8, maxWidth: 340 },
  progressWrap: { paddingTop: 18 }, progressMeta: { paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepCount: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  percent: { color: colors.muted, fontSize: 11, marginTop: 3 }, percentStrong: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  track: { height: 6, marginHorizontal: 20, marginTop: 10, borderRadius: 8, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 6, backgroundColor: colors.primary, borderRadius: 8 },
  tabs: { flexDirection: "row", flexWrap: "nowrap", gap: 4, paddingHorizontal: 12, paddingVertical: 14, alignItems: "stretch" },
  tab: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 2, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  activeTab: { backgroundColor: colors.soft, borderColor: colors.primary }, doneTab: { borderColor: "#B9DFC0" },
  stepDot: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#E8EBF2" },
  activeDot: { backgroundColor: colors.primary }, doneDot: { backgroundColor: "#DDF2E1" },
  stepDotText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, activeDotText: { color: colors.primary },
  tabText: { color: colors.muted, fontSize: 9, fontWeight: "800", textAlign: "center", includeFontPadding: false, flexShrink: 1 }, activeTabText: { color: colors.primary },
  body: { flex: 1, paddingHorizontal: 20 }, heading: { color: colors.ink, fontSize: 21, fontWeight: "900", letterSpacing: -0.45, marginBottom: 8 },
  photoCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, marginBottom: 16 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 2, borderColor: "#D5E7FA" },
  avatarImage: { width: "100%", height: "100%" }, avatarInitials: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  photoCopy: { flex: 1 }, photoTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  photoHelp: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  photoButton: { alignSelf: "flex-start", backgroundColor: colors.soft, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, marginTop: 9 },
  photoButtonText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  help: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 14 },
  choiceRow: { flexDirection: "row", gap: 10, marginBottom: 15 },
  choice: { flex: 1, minHeight: 104, borderWidth: 1.5, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface, padding: 13 },
  choiceSelected: { borderColor: colors.primary, borderWidth: 1.8, backgroundColor: colors.soft, padding: 12.7 },
  choiceTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  choiceTitle: { color: colors.ink, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  choiceDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  choiceRadio: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, borderColor: colors.border },
  choiceRadioSelected: { borderWidth: 5, borderColor: colors.primary },
  roleChoice: { minHeight: 104 },
  roleCheck: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  roleCheckSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleCheckText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  roleHelp: { color: colors.forest, backgroundColor: "#EDF7EF", borderRadius: 10, padding: 11, fontSize: 12, fontWeight: "700", marginBottom: 16 },
  sectionHeading: { color: colors.ink, fontSize: 16, fontWeight: "900", marginTop: 16, marginBottom: 10 },
  field: { marginBottom: 14 }, label: { color: colors.ink, fontSize: 12, fontWeight: "800", marginBottom: 7 },
  inlineFields: { flexDirection: "row", gap: 8, marginBottom: 14 }, codeField: { width: 104 }, phoneField: { flex: 1 },
  selectInput: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", paddingHorizontal: 14, justifyContent: "center", marginBottom: 12 },
  selectText: { color: colors.ink, fontSize: 14 }, optionPanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", marginBottom: 14, maxHeight: 230, overflow: "hidden" },
  searchInput: { minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, color: colors.ink },
  option: { paddingHorizontal: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#EEF1F6" }, optionText: { color: colors.ink, fontSize: 13 }, optionHint: { color: colors.muted, padding: 12, fontSize: 12 },
  saveButtons: { flexDirection: "row", gap: 9 }, saveButtonHalf: { flex: 1 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: "#FFFFFF", paddingHorizontal: 14, color: colors.ink, fontSize: 14 },
  multiline: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  status: { color: colors.muted, fontSize: 12, marginVertical: 6 }, statusValue: { color: colors.ink, fontWeight: "800", marginTop: 6, textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 17, marginVertical: 13, shadowColor: "#173B2C", shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  imagePreview: { width: "100%", height: 190, backgroundColor: "#EEF1F6", borderRadius: 12, marginTop: 10 },
  cameraFrame: { height: 440, overflow: "hidden", borderRadius: 18, backgroundColor: "#101827", marginVertical: 12 },
  cameraOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingVertical: 20 },
  headGuide: { width: 218, height: 286, borderWidth: 3, borderColor: "#FFFFFF", borderRadius: 140, backgroundColor: "transparent", marginVertical: 14 },
  cameraHint: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", textAlign: "center", paddingHorizontal: 18, textShadowColor: "#000000", textShadowRadius: 5 },
  cameraControls: { position: "absolute", left: 14, right: 14, bottom: 14, flexDirection: "row", gap: 10 },
  cameraButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  cameraCancel: { backgroundColor: "#495469" },
  cameraButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  action: { backgroundColor: colors.primary, borderRadius: 11, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 10 },
  actionText: { color: "#FFF", fontWeight: "800", fontSize: 13 }, nav: { marginTop: 12, marginBottom: 25 },
  success: { color: colors.primary, marginTop: 12, fontSize: 12 }, error: { color: "#A12D2D", marginTop: 12, fontSize: 12 },
});
