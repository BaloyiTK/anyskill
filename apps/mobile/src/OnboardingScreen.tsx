import { useEffect, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { CameraView, useCameraPermissions } from "expo-camera";
type CountryOption = { name: string; code: string; dialCode: string };
type AddressSuggestion = { label: string; latitude: number; longitude: number };
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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

export function OnboardingScreen(p: { identityStatus: string; onBack: () => void; onStartVerification: () => void; onIdentityUpdated?: () => void | Promise<unknown>; onComplete: () => void | Promise<void> }) {
  const [active, setActive] = useState<Section>("Profile");
  const [data, setData] = useState<Payload>(empty);
  const [accountType, setAccountType] = useState<AccountType | "">("");
  const [marketplaceRoles, setMarketplaceRoles] = useState<MarketplaceRole[]>([]);
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
  const [uploadingIdentityPurpose, setUploadingIdentityPurpose] = useState<string | null>(null);
  const [identityUploadPercent, setIdentityUploadPercent] = useState(0);
  const [selfieCameraOpen, setSelfieCameraOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const selfieCameraRef = useRef<CameraView>(null);
  const [homeLatitude, setHomeLatitude] = useState("");
  const [homeLongitude, setHomeLongitude] = useState("");
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
    setMessage("Address selected and saved as your Home Location.");
  };

  const uploadIdentityAsset = async (purpose: "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2" | "ID_SELFIE", uri: string, mimeType?: string | null, fileSize?: number | null, originalFileName?: string | null) => {
    setBusy(true); setError(""); setMessage("");
    let stage: "read_file" | "reserve" | "cloudinary_upload" | "confirm" = "read_file";
    try {
      // Expo SDK 58 uses a standards-based FormData serializer. A native
      // { uri, name, type } object is not a supported FormData part; File is a
      // Blob-backed reference to the local URI and avoids copying image bytes
      // into JavaScript memory before upload.
      const file = new File(uri);
      const fileName = originalFileName ?? file.name ?? (purpose === "ID_SELFIE" ? "identity-selfie.jpg" : purpose.toLowerCase().replaceAll("_", "-") + ".jpg");
      const allowedContentTypes = ["image/jpeg", "image/png", "image/webp"];
      const extension = fileName.split(".").pop()?.toLowerCase();
      const extensionMime: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
      const contentType = [file.type, mimeType, extensionMime[extension ?? ""]]
        .map((value) => value?.toLowerCase().split(";")[0]?.trim())
        .find((value) => value && allowedContentTypes.includes(value));
      if (!contentType) throw new Error("Please use a JPEG, PNG or WebP image.");
      if (!Number.isFinite(file.size) || file.size < 1) throw new Error("The selected image could not be read.");
      stage = "reserve";
      const reservation = await apiRequest<{
        assetId: string; cloudName: string; apiKey: string; timestamp: number;
        signature: string; publicId: string; assetFolder: string; maxBytes: number;
      }>("/identity-verification/uploads", {
        method: "POST",
        body: JSON.stringify({ fileName, contentType, sizeBytes: file.size, purpose }),
      }, true);
      if (file.size > reservation.maxBytes) throw new Error("The selected image exceeds the 10 MB upload limit.");
      if (!reservation.cloudName?.trim() || !reservation.apiKey?.trim() || !reservation.signature?.trim()) {
        throw new Error("The secure upload configuration is incomplete. Please contact support.");
      }

      // Upload directly from the native app to Cloudinary using the scoped
      // signature returned by our API. The Cloudinary API secret stays server-side.
      const form = new FormData();
      form.append("file", file, fileName);
      form.append("api_key", reservation.apiKey);
      form.append("timestamp", String(reservation.timestamp));
      form.append("signature", reservation.signature);
      form.append("public_id", reservation.publicId);
      form.append("folder", reservation.assetFolder);
      form.append("type", "authenticated");
      form.append("overwrite", "false");
      form.append("unique_filename", "false");
      form.append("use_filename", "false");
      stage = "cloudinary_upload";
      const uploadUrl = `https://api.cloudinary.com/v1_1/${reservation.cloudName}/image/upload`;
      setUploadingIdentityPurpose(purpose);
      setIdentityUploadPercent(0);
      const uploadResult = await new Promise<{ status: number; body: string; providerError: string | null; contentType: string | null }>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", uploadUrl);
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total > 0) {
            setIdentityUploadPercent(Math.min(99, Math.round((event.loaded / event.total) * 100)));
          }
        };
        request.onload = () => resolve({
          status: request.status,
          body: request.responseText ?? "",
          providerError: request.getResponseHeader("x-cld-error"),
          contentType: request.getResponseHeader("content-type"),
        });
        request.onerror = () => reject(new Error("Network error while uploading the image. Please check your connection and try again."));
        request.ontimeout = () => reject(new Error("The image upload timed out. Please try again."));
        request.onabort = () => reject(new Error("The image upload was cancelled."));
        request.timeout = 120000;
        request.send(form);
      });
      if (uploadResult.status >= 200 && uploadResult.status < 300) {
        setIdentityUploadPercent(100);
      } else {
        let cloudinaryMessage = "";
        try {
          const parsed = JSON.parse(uploadResult.body) as { error?: { message?: string } };
          cloudinaryMessage = parsed.error?.message ?? "";
        } catch {
          cloudinaryMessage = uploadResult.body;
        }
        const providerMessage = uploadResult.providerError || cloudinaryMessage;
        const safeProviderMessage = providerMessage.replace(/[\\r\\n\\t]+/g, " ").slice(0, 240);
        console.error("[AnySkill][IdentityUpload] Cloudinary rejected upload", {
          httpStatus: uploadResult.status,
          providerMessage: safeProviderMessage || "No provider detail returned",
          endpoint: "/image/upload",
          uploadUrl,
          responseContentType: uploadResult.contentType || "unknown",
        });
        throw new Error(
          safeProviderMessage
            ? `Cloudinary rejected the upload (HTTP ${uploadResult.status}): ${safeProviderMessage}`
            : `Cloudinary rejected the upload (HTTP ${uploadResult.status}). Please try again.`,
        );
      }
      stage = "confirm";
      await apiRequest("/identity-verification/uploads/confirm", { method: "POST", body: JSON.stringify({ assetId: reservation.assetId }) }, true);
      setIdentityPreviews((current) => ({ ...current, [purpose]: uri }));
      if (purpose === "ID_DOCUMENT_FRONT") setIdFrontReady(true);
      if (purpose === "ID_DOCUMENT_BACK") setIdBackReady(true);
      if (purpose === "ID_BOOK_PAGE_1") setBookPage1Ready(true);
      if (purpose === "ID_BOOK_PAGE_2") setBookPage2Ready(true);
      if (purpose === "ID_SELFIE") {
        setSelfieReady(true);
        await p.onIdentityUpdated?.();
      }
      setIdDocumentReady(idType === "SMART_ID_CARD" ? (purpose === "ID_DOCUMENT_FRONT" || idFrontReady) && (purpose === "ID_DOCUMENT_BACK" || idBackReady) : purpose === "ID_BOOK_PAGE_1" || bookPage1Ready);
      setMessage(purpose === "ID_SELFIE" ? "Live selfie captured and uploaded securely." : "ID image uploaded securely.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not upload verification image.";
      const errorCode = message.toLowerCase().includes("network") || message.toLowerCase().includes("fetch") ? "network_error" : "upload_failed";
      console.error("[AnySkill][IdentityUpload] Upload failed", { stage, purpose, errorCode, message });
      void apiRequest("/identity-verification/uploads/failure", {
        method: "POST",
        body: JSON.stringify({ purpose, stage, errorCode }),
      }, true).catch((reportError) => {
        console.warn("[AnySkill][IdentityUpload] Could not report failure to API logs", reportError instanceof Error ? reportError.message : "report_failed");
      });
      setError(`Upload failed during ${stage.replace("_", " ")}: ${message}`);
    }
    finally { setBusy(false); setUploadingIdentityPurpose(null); setIdentityUploadPercent(0); }
  };

  const openIdentityUploadOptions = (purpose: "ID_DOCUMENT_FRONT" | "ID_DOCUMENT_BACK" | "ID_BOOK_PAGE_1" | "ID_BOOK_PAGE_2") => {
    Alert.alert("Add document", "Choose how you want to add this image.", [
      { text: "Take picture", onPress: () => void uploadIdentityImage(purpose, "camera") },
      { text: "Choose from gallery", onPress: () => void uploadIdentityImage(purpose, "gallery") },
      { text: "Cancel", style: "cancel" },
    ]);
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
    const idComplete = idType === "SMART_ID_CARD" ? idFrontReady && idBackReady : bookPage1Ready;
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
    if (active === "Verification") { setMessage("Identity verification is optional for now. Any images you have uploaded remain securely saved."); return true; }
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
    if (active === "Verification") { setError(""); setMessage("You can complete identity verification later. Continue building your profile."); setActive("Skills"); return; }
    if (active === "Skills") { if (await save("skills")) setActive("Portfolio"); return; }
    if (active === "Portfolio") { if (await save("portfolio")) setActive("Submit"); return; }
    if (await saveCurrent()) await submit();
  };
  const submit = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/profile/onboarding/submit", { method: "POST", body: "{}" }, true);
      setMessage(result.message);
      await p.onComplete();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit your available information."); }
    finally { setBusy(false); }
  };

  const submittedIdentityStatuses = ["PENDING", "PENDING_REVIEW", "SUBMITTED", "IN_REVIEW", "UNDER_REVIEW", "APPROVED", "VERIFIED", "COMPLETE", "COMPLETED"];
  const identitySubmitted = submittedIdentityStatuses.includes(identityStatus.toUpperCase());
  const identityRequirementsComplete = idType === "SMART_ID_CARD"
    ? idFrontReady && idBackReady && selfieReady
    : bookPage1Ready && selfieReady;
  const verificationComplete = identitySubmitted && identityRequirementsComplete;
  const completedSectionCount = [
    Boolean(data.sections?.profile),
    verificationComplete,
    Boolean(data.sections?.skills),
    Boolean(data.sections?.portfolio),
  ].filter(Boolean).length;
  const completionPercentage = Math.round((completedSectionCount / 4) * 100);
  const status = (key: "profile" | "skills" | "portfolio") => data.sections?.[key] ? "Complete" : "Draft / not complete";
  const Field = (label: string, value: string, change: (v: string) => void, multiline = false) => (
    <View style={st.field} key={label}><Text style={st.label}>{label}</Text><TextInput value={value} onChangeText={change} multiline={multiline} placeholder={label} placeholderTextColor="#93A099" style={[st.input, multiline && st.multiline]} /></View>
  );

  return <View style={st.container}>
    <View style={st.hero}>
      <View style={st.heroTop}>
        <Pressable onPress={p.onBack} accessibilityRole="button" style={st.backButton}><Text style={st.back}>Back</Text></Pressable>
      </View>
      <Text style={st.heroTitle}>Let's build your profile.</Text>
      <Text style={st.heroSubtitle}>Tell us a little about yourself so we can create the right AnySkill experience.</Text>
    </View>
    <View style={st.progressWrap}>
      <View style={st.progressMeta}>
        <View><Text style={st.stepCount}>Step {tabs.indexOf(active) + 1} of 5</Text><Text style={st.percent}>Profile, Skills & Portfolio</Text></View>
        <Text style={st.percentStrong}>{completionPercentage}% complete</Text>
      </View>
      <View style={st.track}><View style={[st.fill, { width: `${completionPercentage}%` }]} /></View>
      <View style={st.tabs}>
        {tabs.map((tab, index) => {
          const completed = [
            Boolean(data.sections?.profile),
            verificationComplete,
            Boolean(data.sections?.skills),
            Boolean(data.sections?.portfolio),
            false,
          ][index];
          const isActive = active === tab;
          const leftConnected = index > 0 && [
            Boolean(data.sections?.profile),
            ["APPROVED", "VERIFIED", "COMPLETE", "COMPLETED"].includes(identityStatus.toUpperCase()),
            Boolean(data.sections?.skills),
            Boolean(data.sections?.portfolio),
          ][index - 1];
          return <Pressable key={tab} onPress={() => setActive(tab)} accessibilityRole="button" accessibilityState={{ selected: isActive }} style={st.tab}>
            <View style={st.stepRow}>
              <View style={[st.connector, index === 0 && st.connectorHidden, leftConnected && st.connectorDone]} />
              <View style={[st.stepDot, isActive && st.activeDot, completed && st.doneDot]}>
                <Text style={[st.stepDotText, isActive && st.activeDotText, completed && st.doneDotText]}>{completed ? "✓" : index + 1}</Text>
              </View>
              <View style={[st.connector, index === tabs.length - 1 && st.connectorHidden, completed && st.connectorDone]} />
            </View>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68} style={[st.tabText, isActive && st.activeTabText, completed && st.doneTabText]}>{tab}</Text>
          </Pressable>;
        })}
      </View>
    </View>
    <ScrollView style={st.body} contentContainerStyle={{ paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      {busy && <ActivityIndicator color={colors.primary} />}
      {active === "Profile" && <>
        <Text style={st.help}>Your live identity selfie will be used as your account avatar once you take it during verification. You do not need to upload another profile picture.</Text>
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
        <Text style={st.label}>Home address</Text>
        <TextInput value={address} onChangeText={(value) => void searchHomeAddress(value)} placeholder="Start typing street, suburb or postcode" placeholderTextColor="#93A099" style={st.input} />
        {addressSearchBusy && <ActivityIndicator color={colors.primary} />}
        {addressSuggestions.length > 0 && <View style={st.optionPanel}>
          {addressSuggestions.map((item, index) => <Pressable key={item.label + index} style={st.option} onPress={() => selectAddress(item)}>
            <Text style={st.optionText}>{item.label}</Text>
          </Pressable>)}
        </View>}
        <Text style={st.help}>Start typing your street address, suburb or postcode and choose a matching suggestion. Your selected country is included in the search.</Text>
        </>}
        <Text style={st.status}>Section: {status("profile")}</Text>
      </>}
      {active === "Verification" && <>
        <Text style={st.heading}>Identity verification (optional)</Text>
        <Text style={st.help}>You can skip this step and complete it later. Identity verification does not count toward your profile completion percentage, but it is required before using restricted marketplace actions.</Text>
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
          { purpose: "ID_BOOK_PAGE_1" as const, label: "Green ID book: photo/details page", ready: bookPage1Ready },
        ]).map((item) => {
          const isUploading = uploadingIdentityPurpose === item.purpose;
          const caseStatus = identityStatus.toLowerCase();
          const isRejected = caseStatus.includes("reject");
          const isVerified = caseStatus.includes("verified") || caseStatus.includes("approved");
          const statusLabel = isRejected ? "Rejected" : isVerified ? "Verified" : item.ready ? (identitySubmitted ? "Pending verification" : "Uploaded — awaiting submission") : "Not submitted";
          return <View key={item.purpose} style={st.card}>
            <Text style={st.label}>{item.label}</Text>
            <Pressable style={st.identityImageFrame} onPress={() => openIdentityUploadOptions(item.purpose)} disabled={busy}>
              {identityPreviews[item.purpose] ? <Image source={{ uri: identityPreviews[item.purpose] }} style={st.identityImage} resizeMode="contain" /> : <View style={st.identityImagePlaceholder}><Text style={st.identityPlaceholderText}>Your document image will appear here</Text></View>}
              <View style={st.identityStatusBadge}><Text style={[st.identityStatusBadgeText, isRejected ? st.identityRejectedText : item.ready && identitySubmitted ? st.identityVerifiedText : st.identityPendingText]}>{isUploading ? "Uploading" : statusLabel}</Text></View>
              <View style={st.identityGlassControl}>
                <View style={st.identityCameraCircle}><Text style={st.identityCameraIcon}>📷</Text></View>
                <Text style={st.identityGlassText}>{item.ready ? "CHANGE DOCUMENT" : "UPLOAD DOCUMENT"}</Text>
              </View>
            </Pressable>
            {isUploading ? <View style={st.identityProgressWrap}>
              <View style={st.identityProgressHeader}><Text style={st.identityProgressLabel}>Uploading document...</Text><Text style={st.identityProgressValue}>{identityUploadPercent}%</Text></View>
              <View style={st.identityProgressTrack}><View style={[st.identityProgressFill, { width: `${identityUploadPercent}%` }]} /></View>
            </View> : null}
            <Text style={st.status}>{isRejected ? "Your document was not approved. Please upload it again." : item.ready ? (identitySubmitted ? "Submitted and awaiting review" : "Uploaded — ready to submit") : "Tap the image to upload a document."}</Text>
          </View>;
        })}
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
        <Text style={st.status}>{selfieReady ? (identitySubmitted ? "Selfie pending verification" : "Live selfie uploaded — awaiting submission") : "Live selfie required"}</Text>
        <Text style={st.help}>Images are stored privately. An administrator will review them later; uploading does not automatically verify your identity.</Text>
        <Action label="Submit identity verification" onPress={() => void submitIdentityVerification()} disabled={busy} />
      </>}
      {active === "Skills" && <>
        <Text style={st.heading}>Skills and experience</Text><Text style={st.help}>Add each skill and attach its supporting documents to that skill. You can skip this section and complete it later.</Text>
        {Field("Skill category", category, setCategory)}{Field("Experience and service description", description, setDescription, true)}
        {Field("Supporting document name", documentName, setDocumentName)}{Field("Supporting document URL (temporary)", documentUrl, setDocumentUrl)}
        <Text style={st.help}>Document upload to AnySkill-managed cloud storage will be connected separately; this field currently records a document reference only.</Text>
        {documentName.trim() && documentUrl.trim() ? <Text style={st.status}>Document status: Pending verification</Text> : null}
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
        <View style={st.saveButtonHalf}><Action label={active === "Submit" ? "Submit & close" : "Save & Continue"} onPress={() => void continueCurrent()} disabled={busy} /></View>
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
  hero: { backgroundColor: colors.hero, paddingHorizontal: 22, paddingTop: 22, paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 28 },
  brand: { color: "#FFFFFF", fontSize: 21, fontWeight: "900", letterSpacing: 0.2 }, brandAccent: { color: colors.green },
  backButton: { borderRadius: 22, paddingHorizontal: 16, paddingVertical: 9, backgroundColor: "#263D5B", borderWidth: 1, borderColor: "#3C5270" }, back: { color: "#E3EAFF", fontSize: 12, fontWeight: "800" },
  heroTitle: { color: "#FFFFFF", fontSize: 28, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8 },
  heroSubtitle: { color: "#C3CDE0", fontSize: 13, lineHeight: 20, marginTop: 9, maxWidth: 340 },
  progressWrap: { paddingTop: 18, paddingBottom: 4, backgroundColor: colors.bg },
  progressMeta: { paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  stepCount: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  percent: { color: colors.muted, fontSize: 11, marginTop: 4 }, percentStrong: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  track: { height: 7, marginHorizontal: 20, marginTop: 11, borderRadius: 10, backgroundColor: "#E2EAF2", overflow: "hidden" },
  fill: { height: 7, backgroundColor: colors.primary, borderRadius: 10 },
  tabs: { flexDirection: "row", flexWrap: "nowrap", paddingHorizontal: 10, paddingTop: 17, paddingBottom: 13, alignItems: "flex-start" },
  tab: { flex: 1, flexBasis: 0, minWidth: 0, alignItems: "center", justifyContent: "flex-start", gap: 7, paddingHorizontal: 0 },
  stepRow: { width: "100%", flexDirection: "row", alignItems: "center" },
  connector: { flex: 1, height: 2, backgroundColor: "#DCE5EF" },
  connectorHidden: { backgroundColor: "transparent" },
  connectorDone: { backgroundColor: colors.green },
  stepDot: { width: 27, height: 27, flexShrink: 0, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#EDF1F5", borderWidth: 1.5, borderColor: "#DCE5EF" },
  activeDot: { backgroundColor: colors.primary, borderColor: colors.primary },
  doneDot: { backgroundColor: colors.green, borderColor: colors.green },
  stepDotText: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  activeDotText: { color: "#FFFFFF" },
  doneDotText: { color: "#FFFFFF", fontSize: 13 },
  tabText: { color: colors.muted, fontSize: 9, fontWeight: "800", textAlign: "center", includeFontPadding: false, flexShrink: 1 },
  activeTabText: { color: colors.primary },
  doneTabText: { color: colors.forest },
  body: { flex: 1, paddingHorizontal: 18 },
  heading: { color: colors.ink, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, marginBottom: 10 },
  photoCard: { flexDirection: "row", alignItems: "center", gap: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: "#E4EAF1", borderRadius: 20, padding: 16, marginBottom: 20, shadowColor: "#0B2545", shadowOpacity: 0.055, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  avatar: { width: 78, height: 78, borderRadius: 24, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 2, borderColor: "#D5E7FA" },
  avatarImage: { width: "100%", height: "100%" }, avatarInitials: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  photoCopy: { flex: 1 }, photoTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  photoHelp: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  photoButton: { alignSelf: "flex-start", backgroundColor: colors.soft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginTop: 10, borderWidth: 1, borderColor: "#D6E8FC" },
  photoButtonText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  help: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 14 },
  choiceRow: { flexDirection: "row", gap: 10, marginBottom: 17 },
  choice: { flex: 1, minHeight: 108, borderWidth: 1.5, borderColor: "#E1E8F0", borderRadius: 17, backgroundColor: colors.surface, padding: 14, shadowColor: "#0B2545", shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  choiceSelected: { borderColor: colors.primary, borderWidth: 1.8, backgroundColor: "#F1F7FF", padding: 13.7 },
  choiceTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  choiceTitle: { color: colors.ink, fontSize: 13, fontWeight: "800", flexShrink: 1 },
  choiceDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 9 },
  choiceRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: "#B9C6D4" },
  choiceRadioSelected: { borderWidth: 5, borderColor: colors.primary },
  roleChoice: { minHeight: 108 },
  roleCheck: { width: 21, height: 21, borderRadius: 6, borderWidth: 1.5, borderColor: "#B9C6D4", alignItems: "center", justifyContent: "center" },
  roleCheckSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleCheckText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  roleHelp: { color: colors.forest, backgroundColor: "#EDF7EF", borderRadius: 12, padding: 12, fontSize: 12, fontWeight: "700", marginBottom: 18, overflow: "hidden" },
  sectionHeading: { color: colors.ink, fontSize: 17, fontWeight: "900", marginTop: 19, marginBottom: 12, letterSpacing: -0.2 },
  field: { marginBottom: 16 },
  label: { color: colors.ink, fontSize: 12, fontWeight: "800", marginBottom: 8 },
  inlineFields: { flexDirection: "row", gap: 9, marginBottom: 15 }, codeField: { width: 104 }, phoneField: { flex: 1 },
  selectInput: { minHeight: 54, borderWidth: 1, borderColor: "#DCE5EF", borderRadius: 13, backgroundColor: "#FFFFFF", paddingHorizontal: 15, justifyContent: "center", marginBottom: 13 },
  selectText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  optionPanel: { borderWidth: 1, borderColor: "#DCE5EF", borderRadius: 13, backgroundColor: "#FFFFFF", marginBottom: 15, maxHeight: 230, overflow: "hidden" },
  searchInput: { minHeight: 46, borderBottomWidth: 1, borderBottomColor: "#E8EDF3", paddingHorizontal: 13, color: colors.ink },
  option: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F0F3F7" },
  optionText: { color: colors.ink, fontSize: 13 }, optionHint: { color: colors.muted, padding: 13, fontSize: 12 },
  saveButtons: { flexDirection: "row", gap: 10, marginTop: 12 }, saveButtonHalf: { flex: 1 },
  input: { minHeight: 54, borderWidth: 1, borderColor: "#DCE5EF", borderRadius: 13, backgroundColor: "#FFFFFF", paddingHorizontal: 15, color: colors.ink, fontSize: 14 },
  multiline: { minHeight: 96, paddingTop: 13, textAlignVertical: "top" },
  status: { color: colors.muted, fontSize: 12, marginVertical: 7 }, statusValue: { color: colors.ink, fontWeight: "800", marginTop: 7, textTransform: "capitalize" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: "#E4EAF1", borderRadius: 19, padding: 17, marginVertical: 14, shadowColor: "#0B2545", shadowOpacity: 0.045, shadowRadius: 11, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  imagePreview: { width: "100%", height: 190, backgroundColor: "#EEF2F6", borderRadius: 14, marginTop: 11 },
  identityImageFrame: { height: 190, borderRadius: 14, overflow: "hidden", backgroundColor: "#DCE6E9", position: "relative", justifyContent: "center", alignItems: "center", marginTop: 10 },
  identityImage: { width: "100%", height: "100%", backgroundColor: "#DCE6E9" },
  identityImagePlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 20 },
  identityPlaceholderText: { color: "#71858A", fontSize: 12, fontWeight: "600", textAlign: "center" },
  identityStatusBadge: { position: "absolute", top: 9, right: 9, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.94)" },
  identityStatusBadgeText: { fontSize: 10, fontWeight: "800" },
  identityPendingText: { color: "#91651C" },
  identityVerifiedText: { color: "#26744B" },
  identityRejectedText: { color: "#A33D35" },
  identityGlassControl: { position: "absolute", alignItems: "center", justifyContent: "center", paddingHorizontal: 15, paddingVertical: 9, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.66)", borderWidth: 1, borderColor: "rgba(255,255,255,0.8)" },
  identityCameraCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.86)", alignItems: "center", justifyContent: "center" },
  identityCameraIcon: { color: "#263B43", fontSize: 19, lineHeight: 25, fontWeight: "700" },
  identityGlassText: { color: "#263B43", fontSize: 9, fontWeight: "900", letterSpacing: 0.55, marginTop: 4 },
  identityProgressWrap: { paddingTop: 10, paddingHorizontal: 2 },
  identityProgressHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  identityProgressLabel: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  identityProgressValue: { color: colors.primary, fontSize: 12, fontWeight: "900", fontVariant: ["tabular-nums"] },
  identityProgressTrack: { height: 5, borderRadius: 5, backgroundColor: "#E4EAF1", overflow: "hidden" },
  identityProgressFill: { height: 5, borderRadius: 5, backgroundColor: "#2995C9" },
  cameraFrame: { height: 440, overflow: "hidden", borderRadius: 20, backgroundColor: "#101827", marginVertical: 14 },
  cameraOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", paddingVertical: 20 },
  headGuide: { width: 218, height: 286, borderWidth: 3, borderColor: "#FFFFFF", borderRadius: 140, backgroundColor: "transparent", marginVertical: 14 },
  cameraHint: { color: "#FFFFFF", fontSize: 13, fontWeight: "800", textAlign: "center", paddingHorizontal: 18, textShadowColor: "#000000", textShadowRadius: 5 },
  cameraControls: { position: "absolute", left: 14, right: 14, bottom: 14, flexDirection: "row", gap: 10 },
  cameraButton: { flex: 1, minHeight: 50, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  cameraCancel: { backgroundColor: "#495469" },
  cameraButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  action: { backgroundColor: colors.primary, borderRadius: 13, minHeight: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: 17, marginTop: 10, shadowColor: colors.primary, shadowOpacity: 0.15, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  actionText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  nav: { marginTop: 12, marginBottom: 25 },
  success: { color: colors.primary, marginTop: 13, fontSize: 12, fontWeight: "700" },
  error: { color: "#A12D2D", marginTop: 13, fontSize: 12, fontWeight: "700" },
});