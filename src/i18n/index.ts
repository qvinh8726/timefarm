import type { AppLanguage } from "../domain/types";

export type TranslationResource = {
  shell: {
    opening: string;
    checkingCloudWorkspace: string;
  };
  workspace: {
    dashboard: string;
    projects: string;
    history: string;
    analytics: string;
    profile: string;
    settings: string;
    start: string;
    pause: string;
    resume: string;
    stop: string;
    today: string;
    workTime: string;
    earnings: string;
    efficiency: string;
    sessions: string;
    noProject: string;
    active: string;
    paused: string;
    completed: string;
    cancel: string;
    save: string;
    create: string;
    edit: string;
    add: string;
    back: string;
  };
  duration: {
    hour: string;
    hours: string;
    minute: string;
    minutes: string;
  };
  authentication: {
    brandEyebrow: string;
    brandHeadlineFirst: string;
    brandHeadlineSecond: string;
    brandDescription: string;
    valueOfflineTimer: string;
    valueOriginalEarnings: string;
    valueDataControl: string;
    signIn: string;
    signUp: string;
    signInEyebrow: string;
    signUpEyebrow: string;
    signInHeading: string;
    signUpHeading: string;
    signInDescription: string;
    signUpDescription: string;
    continueWithGoogle: string;
    or: string;
    displayName: string;
    displayNamePlaceholder: string;
    email: string;
    password: string;
    passwordPlaceholder: string;
    processing: string;
    authNote: string;
    signUpConfirmationRequired: string;
    unableToAuthenticate: string;
    googleStarted: string;
    unableToStartGoogle: string;
  };
  onboarding: {
    artEyebrow: string;
    artHeadlineFirst: string;
    artHeadlineSecond: string;
    artDescription: string;
    languageAria: string;
    vietnamese: string;
    english: string;
    setupEyebrow: string;
    setupHeading: string;
    setupDescription: string;
    nameLabel: string;
    namePlaceholder: string;
    countryLabel: string;
    currencyLabel: string;
    countryVietnam: string;
    countryUnitedStates: string;
    countryUnitedKingdom: string;
    countryJapan: string;
    countryGermany: string;
    timezoneHint: string;
    enterWorkspace: string;
    offlineMode: string;
    accountMode: string;
    accountFallback: string;
  };
  dataLoad: {
    eyebrow: string;
    heading: string;
    description: string;
    retry: string;
  };
  cloudBootstrap: {
    eyebrow: string;
    heading: string;
    description: string;
    retry: string;
    signOut: string;
  };
  ownership: {
    claimEyebrow: string;
    claimHeading: string;
    claimDescription: string;
    localProfile: string;
    signedInAccount: string;
    consent: string;
    claimAction: string;
    mismatchEyebrow: string;
    mismatchHeading: string;
    mismatchDescription: string;
    localData: string;
    signedInAs: string;
    signOutAction: string;
    resetDescription: string;
    resetAction: string;
  };
};

const vi: TranslationResource = {
  shell: {
    opening: "Đang mở TimeFarm…",
    checkingCloudWorkspace: "Đang kiểm tra không gian làm việc trên cloud…",
  },
  workspace: {
    dashboard: "Tổng quan",
    projects: "Dự án",
    history: "Lịch sử",
    analytics: "Phân tích",
    profile: "Hồ sơ",
    settings: "Cài đặt",
    start: "Bắt đầu phiên",
    pause: "Tạm dừng",
    resume: "Tiếp tục",
    stop: "Kết thúc",
    today: "Hôm nay",
    workTime: "Thời gian làm việc",
    earnings: "Thu nhập",
    efficiency: "Thu nhập / giờ",
    sessions: "Phiên làm việc",
    noProject: "Không gắn dự án",
    active: "Đang hoạt động",
    paused: "Đang tạm dừng",
    completed: "Hoàn thành",
    cancel: "Hủy",
    save: "Lưu",
    create: "Tạo mới",
    edit: "Chỉnh sửa",
    add: "Thêm",
    back: "Quay lại",
  },
  duration: { hour: "giờ", hours: "giờ", minute: "phút", minutes: "phút" },
  authentication: {
    brandEyebrow: "CÔNG VIỆC CỦA BẠN, ĐƯỢC NHÌN RÕ",
    brandHeadlineFirst: "Thời gian thật.",
    brandHeadlineSecond: "Giá trị thật.",
    brandDescription:
      "Đăng nhập để bảo vệ dữ liệu, đồng bộ an toàn và xem lại công việc của bạn trên các thiết bị.",
    valueOfflineTimer: "Timer vẫn hoạt động khi offline",
    valueOriginalEarnings: "Thu nhập luôn giữ nguyên bản gốc",
    valueDataControl: "Bạn kiểm soát dữ liệu của mình",
    signIn: "Đăng nhập",
    signUp: "Tạo tài khoản",
    signInEyebrow: "CHÀO MỪNG TRỞ LẠI",
    signUpEyebrow: "BẮT ĐẦU AN TOÀN",
    signInHeading: "Tiếp tục với TimeFarm.",
    signUpHeading: "Tạo không gian làm việc của bạn.",
    signInDescription: "Dữ liệu đồng bộ vẫn thuộc về bạn.",
    signUpDescription:
      "Dùng email hoặc Google. Không lưu mật khẩu trong ứng dụng.",
    continueWithGoogle: "Tiếp tục với Google",
    or: "hoặc",
    displayName: "Tên hiển thị",
    displayNamePlaceholder: "Ví dụ: Minh",
    email: "Email",
    password: "Mật khẩu",
    passwordPlaceholder: "Ít nhất 8 ký tự",
    processing: "Đang xử lý…",
    authNote:
      "Email/password dùng Supabase Auth; token phiên được mã hóa bởi Windows Credential Protection trước khi được lưu cục bộ.",
    signUpConfirmationRequired:
      "Tài khoản đã được tạo. Hãy kiểm tra cấu hình Supabase: Email confirmation phải tắt cho luồng v1 hoặc xác nhận email trước khi tiếp tục.",
    unableToAuthenticate: "Không thể xác thực tài khoản.",
    googleStarted:
      "Trình duyệt đã mở để đăng nhập Google. Quay lại TimeFarm sau khi hoàn tất.",
    unableToStartGoogle: "Không thể bắt đầu đăng nhập Google.",
  },
  onboarding: {
    artEyebrow: "PERSONAL WORK INTELLIGENCE",
    artHeadlineFirst: "Đừng chỉ đếm giờ.",
    artHeadlineSecond: "Hãy hiểu giá trị công việc của bạn.",
    artDescription:
      "Ghi nhận thời gian thực sự làm việc, thu nhập thực tế và các xu hướng đáng tin cậy — ngay cả khi offline.",
    languageAria: "Ngôn ngữ",
    vietnamese: "Tiếng Việt",
    english: "English",
    setupEyebrow: "THIẾT LẬP LẦN ĐẦU",
    setupHeading: "Bắt đầu theo cách của bạn.",
    setupDescription:
      "Thông tin này thuộc về tài khoản và có thể dùng offline trên thiết bị này.",
    nameLabel: "Bạn muốn được gọi là gì?",
    namePlaceholder: "Ví dụ: Minh",
    countryLabel: "Quốc gia",
    currencyLabel: "Đơn vị tiền tệ",
    countryVietnam: "Việt Nam",
    countryUnitedStates: "Hoa Kỳ",
    countryUnitedKingdom: "Vương quốc Anh",
    countryJapan: "Nhật Bản",
    countryGermany: "Đức",
    timezoneHint:
      "Múi giờ thiết bị sẽ là {{timezone}}. Quốc gia và tiền tệ được giữ ổn định để bảo toàn lịch sử.",
    enterWorkspace: "Vào không gian làm việc",
    offlineMode:
      "Chế độ local development: chưa cấu hình máy chủ xác thực. Dữ liệu vẫn được lưu offline trên thiết bị.",
    accountMode: "Bạn đang thiết lập hồ sơ cho {{email}}.",
    accountFallback: "tài khoản của mình",
  },
  dataLoad: {
    eyebrow: "BẢO VỆ DỮ LIỆU LOCAL",
    heading: "Chưa thể mở dữ liệu trên máy.",
    description:
      "TimeFarm không tạo dữ liệu trống và cũng không thay đổi dữ liệu đã lưu khi việc đọc SQLite/IPC thất bại. Hãy kiểm tra lại rồi thử đọc lại an toàn.",
    retry: "Thử lại",
  },
  cloudBootstrap: {
    eyebrow: "BẢO VỆ DỮ LIỆU CLOUD",
    heading:
      "Chúng tôi chưa thể kiểm tra an toàn không gian làm việc trên cloud của bạn.",
    description:
      "Để tránh tạo hồ sơ mới có thể ghi đè công việc đã lưu trên thiết bị khác, hãy kết nối lại và xác minh tài khoản cloud trước khi thiết lập máy tính này.",
    retry: "Thử lại",
    signOut: "Đăng xuất để dùng tài khoản khác",
  },
  ownership: {
    claimEyebrow: "QUYỀN SỞ HỮU DỮ LIỆU LOCAL",
    claimHeading: "Gắn dữ liệu local với tài khoản?",
    claimDescription:
      "Dữ liệu hiện có trên thiết bị chưa từng được gắn với một tài khoản cloud. Để tránh trộn dữ liệu của người khác, TimeFarm cần bạn xác nhận rõ ràng trước khi đồng bộ.",
    localProfile: "Hồ sơ local",
    signedInAccount: "Tài khoản đăng nhập",
    consent:
      "Tôi xác nhận dữ liệu local này thuộc về tôi và có thể được gắn với tài khoản trên.",
    claimAction: "Gắn dữ liệu và tiếp tục",
    mismatchEyebrow: "BẢO VỆ TÀI KHOẢN",
    mismatchHeading: "Tài khoản không khớp.",
    mismatchDescription:
      "Dữ liệu trên máy này đã được gắn với một tài khoản cloud khác. TimeFarm không tự động ghi đè hay trộn dữ liệu giữa các tài khoản.",
    localData: "Dữ liệu local",
    signedInAs: "Đang đăng nhập",
    signOutAction: "Đăng xuất để dùng tài khoản khác",
    resetDescription:
      "Nếu dữ liệu local không thuộc tài khoản này, bạn có thể xóa dữ liệu trên thiết bị sau khi xác nhận trong hộp thoại hệ thống.",
    resetAction: "Xóa dữ liệu trên thiết bị",
  },
};

const en: TranslationResource = {
  shell: {
    opening: "Opening TimeFarm…",
    checkingCloudWorkspace: "Checking your cloud workspace…",
  },
  workspace: {
    dashboard: "Dashboard",
    projects: "Projects",
    history: "History",
    analytics: "Analytics",
    profile: "Profile",
    settings: "Settings",
    start: "Start session",
    pause: "Pause",
    resume: "Resume",
    stop: "End session",
    today: "Today",
    workTime: "Work time",
    earnings: "Earnings",
    efficiency: "Earnings / hour",
    sessions: "Sessions",
    noProject: "No project",
    active: "Active",
    paused: "Paused",
    completed: "Completed",
    cancel: "Cancel",
    save: "Save",
    create: "Create",
    edit: "Edit",
    add: "Add",
    back: "Back",
  },
  duration: {
    hour: "hour",
    hours: "hours",
    minute: "minute",
    minutes: "minutes",
  },
  authentication: {
    brandEyebrow: "YOUR WORK, CLEARLY SEEN",
    brandHeadlineFirst: "Real time.",
    brandHeadlineSecond: "Real value.",
    brandDescription:
      "Sign in to protect your data, synchronize safely, and revisit your work across devices.",
    valueOfflineTimer: "The timer still works offline",
    valueOriginalEarnings: "Earnings always retain their original currency",
    valueDataControl: "You control your data",
    signIn: "Sign in",
    signUp: "Create account",
    signInEyebrow: "WELCOME BACK",
    signUpEyebrow: "GET STARTED SECURELY",
    signInHeading: "Continue with TimeFarm.",
    signUpHeading: "Create your workspace.",
    signInDescription: "Your synchronized data still belongs to you.",
    signUpDescription:
      "Use email or Google. Passwords are not stored in the app.",
    continueWithGoogle: "Continue with Google",
    or: "or",
    displayName: "Display name",
    displayNamePlaceholder: "For example: Alex",
    email: "Email",
    password: "Password",
    passwordPlaceholder: "At least 8 characters",
    processing: "Working…",
    authNote:
      "Email/password uses Supabase Auth; the session token is encrypted with Windows Credential Protection before local storage.",
    signUpConfirmationRequired:
      "Your account was created. Check your Supabase configuration: disable email confirmation for the v1 flow, or confirm your email before continuing.",
    unableToAuthenticate: "Unable to authenticate the account.",
    googleStarted:
      "Your browser opened for Google sign-in. Return to TimeFarm after completing it.",
    unableToStartGoogle: "Unable to start Google sign-in.",
  },
  onboarding: {
    artEyebrow: "PERSONAL WORK INTELLIGENCE",
    artHeadlineFirst: "Do more than count hours.",
    artHeadlineSecond: "Understand the value of your work.",
    artDescription:
      "Record real work time, real earnings, and trustworthy trends — even when you are offline.",
    languageAria: "Language",
    vietnamese: "Tiếng Việt",
    english: "English",
    setupEyebrow: "FIRST-TIME SETUP",
    setupHeading: "Make your work count.",
    setupDescription:
      "These settings belong to your account and work offline on this device.",
    nameLabel: "What should we call you?",
    namePlaceholder: "For example: Alex",
    countryLabel: "Country",
    currencyLabel: "Account currency",
    countryVietnam: "Vietnam",
    countryUnitedStates: "United States",
    countryUnitedKingdom: "United Kingdom",
    countryJapan: "Japan",
    countryGermany: "Germany",
    timezoneHint:
      "Your device timezone will be {{timezone}}. Country and currency remain stable to preserve historical data.",
    enterWorkspace: "Enter workspace",
    offlineMode:
      "Local development mode: no authentication server is configured. Your data is still saved offline on this device.",
    accountMode: "You are setting up the profile for {{email}}.",
    accountFallback: "your account",
  },
  dataLoad: {
    eyebrow: "LOCAL DATA PROTECTION",
    heading: "Your data could not be opened on this computer.",
    description:
      "TimeFarm does not create empty data or change saved data when reading SQLite/IPC fails. Check the connection and retry safely.",
    retry: "Try again",
  },
  cloudBootstrap: {
    eyebrow: "CLOUD DATA PROTECTION",
    heading: "We could not safely check your cloud workspace.",
    description:
      "To avoid creating a new profile that could overwrite work saved on another device, reconnect and verify the cloud account before setting up this computer.",
    retry: "Try again",
    signOut: "Sign out to use another account",
  },
  ownership: {
    claimEyebrow: "LOCAL DATA OWNERSHIP",
    claimHeading: "Link local data to this account?",
    claimDescription:
      "The data already on this device has never been linked to a cloud account. To avoid mixing another person’s data, TimeFarm needs your explicit confirmation before syncing.",
    localProfile: "Local profile",
    signedInAccount: "Signed-in account",
    consent:
      "I confirm that this local data belongs to me and may be linked to the account above.",
    claimAction: "Link data and continue",
    mismatchEyebrow: "ACCOUNT PROTECTION",
    mismatchHeading: "The account does not match.",
    mismatchDescription:
      "Data on this computer is already linked to another cloud account. TimeFarm does not automatically overwrite or mix data between accounts.",
    localData: "Local data",
    signedInAs: "Signed in as",
    signOutAction: "Sign out to use another account",
    resetDescription:
      "If this local data does not belong to the signed-in account, you can clear it after confirming in the native system dialog.",
    resetAction: "Clear device data",
  },
};

export const resources = { vi, en } as const satisfies Record<
  AppLanguage,
  TranslationResource
>;

export type TranslationSection = keyof TranslationResource;
export type TranslationKey<Section extends TranslationSection> =
  keyof TranslationResource[Section];
export type TranslationValues = Record<
  string,
  string | number | null | undefined
>;

export function translate<
  Section extends TranslationSection,
  Key extends TranslationKey<Section>,
>(
  language: AppLanguage,
  section: Section,
  key: Key,
  values?: TranslationValues,
): string {
  const template = resources[language][section][key] as string;
  if (!values) return template;
  return template.replace(
    /{{([a-zA-Z0-9_]+)}}/g,
    (placeholder, name: string) => {
      const value = values[name];
      return value === undefined || value === null
        ? placeholder
        : String(value);
    },
  );
}

export function localeFor(language: AppLanguage): string {
  return language === "vi" ? "vi-VN" : "en-US";
}
