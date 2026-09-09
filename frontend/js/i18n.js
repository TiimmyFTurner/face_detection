/**
 * I18n — Internationalization engine for FaceTrack.
 * Supports Persian (fa) [Default] and English (en).
 * Handles translation dictionaries, Solar Hijri / Jalali timestamps,
 * RTL/LTR layout switching, and local storage persistence.
 */
const I18n = {
    _lang: 'fa', // Default is 'fa' (Persian)
    _listeners: [],

    translations: {
        fa: {
            // Brand & Navigation
            brand_name: 'فیس‌ترک',
            brand_subtitle: 'سامانه تشخیص چهره هوشمند',
            nav_dashboard: 'پیشخوان',
            nav_duty: 'پرسنل در شیفت',
            nav_zones: 'منطقه‌ها و شیفت‌ها',
            nav_cameras: 'دوربین‌ها',
            nav_persons: 'هویت‌ها و چهره‌ها',
            nav_settings: 'تنظیمات سیستم',
            ws_connected: 'متصل شد',
            ws_reconnecting: 'در حال اتصال مجدد...',
            ws_connecting: 'در حال برقراری ارتباط...',
            lang_switcher_label: 'زبان سیستم',

            // Live Duty Screen
            duty_title: '⏱️ پایش زنده پرسنل در ساعات شیفت',
            duty_subtitle: 'نظارت لحظه‌ای بر حضور، غیبت جاری و مجموع زمان عدم حضور در محل خدمت',
            kpi_staff_on_duty: 'پرسنل در ساعت شیفت',
            kpi_on_station: 'حاضر در منطقه',
            kpi_absent_now: 'غایب از منطقه',
            kpi_total_shift_absence: 'مجموع کل غیبت شیفت جاری',
            kpi_total_absence_incidents: 'مجموع دفعات خروج از منطقه',
            kpi_avg_compliance: 'میانگین انضباط شیفت',
            filter_all_duty: 'همه پرسنل در شیفت',
            filter_present: '🟢 حاضرین در منطقه',
            filter_absent: '🔴 غایبین از منطقه',
            toggle_only_active: 'فقط شیفت‌های فعال هم‌اکنون',
            auto_refresh_badge: 'بروزرسانی: {sec} ثانیه',
            shift_window_badge: 'بازه زمانی شیفت: {window}',
            current_absence_badge: '⏱️ غیبت لحظه‌ای: {time}',
            current_absence_title: 'غیبت لحظه‌ای (عدم حضور در منطقه)',
            sum_shift_absence_title: 'مجموع غیبت در شیفت جاری',
            sum_shift_absence_desc: '{absent} غیبت از {elapsed} سپری شده',
            absence_count_badge: '{count} بار غیبت در این شیفت',
            absence_count_short: '{count} بار غیبت',
            absence_windows_btn: 'بازه‌های زمانی غیبت ({count})',
            absence_windows_title: 'بازه‌های زمانی عدم حضور در منطقه',
            no_absence_intervals: 'بدون ثبت غیبت در این شیفت',
            interval_type_late_arrival: 'تاخیر در ورود',
            interval_type_gap: 'خروج از منطقه',
            interval_type_current: 'غیبت جاری',
            interval_type_unseen: 'عدم حضور از ابتدای شیفت',
            interval_type_early_leave: 'خروج زودتر از موعد',
            window_now: 'هم‌اکنون',
            in_zone_present: '🟢 حاضر در محل خدمت',
            in_zone_ago: 'حاضر (رؤیت: {sec} ثانیه پیش)',
            absent_missing_mins: '🔴 غایب از منطقه ({mins} دقیقه)',
            absent_not_seen: '🔴 عدم حضور از ابتدای شیفت',
            compliance_rate_label: 'نرخ حضور در شیفت: {pct}%',
            no_duty_title: 'هیچ پرسنلی در این ساعت شیفت کاری فعال ندارد',
            no_duty_desc: 'در حال حاضر هیچ شیفتی برای پرسنل فعال نیست یا ساعات کاری به اتمام رسیده است.',

            // Common / Actions
            live: 'زنده',
            close: 'بستن',
            cancel: 'انصراف',
            save: 'ذخیره',
            save_changes: 'ذخیره تغییرات',
            delete: 'حذف',
            edit: 'ویرایش',
            test: 'تست',
            refresh: 'بروزرسانی',
            active: 'فعال',
            inactive: 'غیرفعال',
            online: 'آنلاین',
            disconnected: 'قطع ارتباط',
            loading: 'در حال بارگذاری...',
            unknown: 'ناشناس',
            unidentified: 'چهره ناشناس',
            known: 'شناسایی شده',
            known_identity: 'هویت شناخته شده',
            none: 'هیچ',
            all: 'همه',
            details: 'جزئیات',
            search: 'جستجو',
            view_grid: 'نمای شبکه‌ای',
            view_list: 'نمای لیستی',

            // Dashboard
            dashboard_title: 'پیشخوان رویدادها',
            stat_total_today: 'مجموع رویدادهای امروز',
            stat_known_today: 'چهره‌های شناسایی شده',
            stat_unknown_today: 'چهره‌های ناشناس',
            stat_active_cameras: 'دوربین‌های فعال',
            filter_all: 'همه رویدادها',
            filter_known: '✅ شناسایی شده',
            filter_unknown: '❓ ناشناس',
            mode_stream: '📜 جریان زنده فعالیت',
            mode_grouped: '👥 دسته‌بندی بر اساس شخص',
            no_events_title: 'هنوز رویدادی ثبت نشده است',
            no_events_desc: 'به محض فعال شدن دوربین‌ها و تشخیص چهره، رویدادها به صورت زنده در اینجا نمایش داده می‌شوند.',
            no_grouped_title: 'هیچ رویداد دسته‌بندی شده‌ای وجود ندارد',
            no_grouped_desc: 'هنوز هیچ رویداد تشخیصی ثبت نشده است.',
            failed_load_events: 'خطا در بارگذاری رویدادها',
            detections_count: '{count} تردد ثبت شده',
            latest_time: 'آخرین مشاهده: {time}',

            // Event Details Modal & Card
            event_details_title: '🎯 جزئیات رویداد شماره #{id}',
            event_camera: 'منبع دوربین',
            event_area: 'محدوده / منطقه',
            event_timestamp: 'زمان تشخیص (به وقت محلی)',
            event_confidence: 'درصد تطابق چهره',
            event_person_identity: 'هویت تشخیص داده شده',
            enroll_person: '➕ ثبت چهره جدید',
            view_persons: '👤 مشاهده هویت‌ها',
            alert_out_of_zone: '⚠️ خارج از منطقه مجاز',
            alert_unauthorized: '🚨 ورود غیرمجاز',
            alert_absence_timeout: '⏱️ عدم حضور بیش از حد مجاز',
            alert_camera_disconnected: '⚠️ قطع ارتباط دوربین',
            filter_camera_offline: 'دوربین قطع',
            badge_camera_offline: '🟡 دوربین قطع است',
            status_camera_offline: 'دوربین قطع است',
            camera_feed_unavailable: 'سیگنال دوربین در دسترس نیست',
            kpi_camera_offline_title: 'دوربین‌های قطع',
            duty_camera_disconnected_badge: '{count} دوربین قطع',
            other_detections_for: '📸 سایر ترددهای ثبت شده برای {name} ({count})',
            click_to_view: 'برای مشاهده کلیک کنید',
            no_image: 'بدون تصویر',

            // Cameras Page
            cameras_title: 'مدیریت دوربین‌ها',
            add_camera_btn: '＋ افزودن دوربین',
            loading_cameras: 'در حال بارگذاری دوربین‌ها...',
            no_cameras_title: 'هیچ دوربینی تنظیم نشده است',
            no_cameras_desc: 'برای شروع تشخیص چهره، اولین دوربین مداربسته IP خود را اضافه کنید.',
            camera_live_stream: 'پخش زنده',
            camera_zones_btn: 'منطقه‌ها',
            camera_test_btn: '⚡ تست',
            camera_edit_btn: '✏️ ویرایش',
            camera_delete_btn: 'حذف',
            camera_location: 'موقعیت:',
            camera_added: 'افزوده شده در {date}',
            confirm_delete_camera: 'آیا از حذف دوربین «{name}» اطمینان دارید؟ پخش زنده و تنظیمات آن متوقف خواهد شد.',
            camera_deleted_toast: 'دوربین «{name}» با موفقیت حذف شد.',
            testing_connection: 'در حال بررسی اتصال به دوربین...',
            test_success: '✅ اتصال به دوربین با موفقیت برقرار شد!',
            test_failed: '❌ خطا در اتصال به دوربین',
            camera_saved_success: 'دوربین با موفقیت ذخیره شد!',
            camera_added_success: 'دوربین با موفقیت اضافه شد!',
            refresh_snapshot: '🔄 تازه‌سازی تصویر',
            full_resolution: '🔗 کیفیت اصلی',

            // Camera Form Modal
            modal_add_camera: 'افزودن دوربین جدید',
            modal_edit_camera: 'ویرایش مشخصات دوربین',
            label_camera_name: 'نام دوربین',
            placeholder_camera_name: 'مثلاً دوربین ورودی اصلی',
            label_rtsp_url: 'آدرس جریان RTSP',
            placeholder_rtsp_url: 'rtsp://user:pass@192.168.1.100:554/stream',
            label_location: 'موقعیت مکانی',
            placeholder_location: 'مثلاً ورودی اصلی، لابی، انبار',
            label_active: 'فعال بودن دوربین',
            btn_test_connection: '⚡ تست اتصال',

            // Camera Tabs & Creation Modes
            tab_camera_direct: 'لینک مستقیم RTSP',
            tab_camera_builder: 'مشخصات IP و اعتبارسنجی',
            tab_camera_batch: 'افزودن دسته‌ای (فایل / متنی)',

            // RTSP URL Builder
            builder_ip: 'آدرس IP دوربین',
            builder_ip_placeholder: 'مثلاً 192.168.1.100',
            builder_port: 'پورت RTSP',
            builder_port_placeholder: '554',
            builder_username: 'نام کاربری (اختیاری)',
            builder_username_placeholder: 'admin',
            builder_password: 'رمز عبور (اختیاری)',
            builder_password_placeholder: 'رمز عبور',
            builder_preset: 'الگوی مسیر جریان',
            preset_generic: 'عمومی / Generic (/h264Preview_01_main)',
            preset_hikvision_main: 'هایک‌ویژن اصلی / Hikvision (/Streaming/Channels/101)',
            preset_hikvision_sub: 'هایک‌ویژن فرعی (/Streaming/Channels/102)',
            preset_dahua_main: 'داهوا اصلی / Dahua (/cam/realmonitor?channel=1&subtype=0)',
            preset_dahua_sub: 'داهوا فرعی (/cam/realmonitor?channel=1&subtype=1)',
            preset_uniview: 'یونی‌ویو / Uniview (/media/video1)',
            preset_custom: 'مسیر سفارشی (تایپ دستی)',
            builder_path: 'مسیر جریان (Stream Path)',
            builder_path_placeholder: 'مثلاً /live/ch0 یا /stream1',
            builder_preview: 'پیش‌نمایش آدرس RTSP تولید شده',
            builder_copy: 'کپی آدرس',
            builder_copied: 'آدرس کپی شد!',

            // Batch Camera Import
            batch_import_desc: 'آدرس‌های RTSP را در کادر زیر وارد کنید (هر خط یک آدرس) یا فایل متنی حاوی لیست لینک‌ها (.txt) را بارگذاری نمایید. هر دوربین به عنوان یک دوربین مجزا اضافه خواهد شد.',
            batch_paste_label: 'لیست آدرس‌های RTSP (هر خط یک آدرس)',
            batch_upload_btn: '📁 بارگذاری فایل متنی (.txt)',
            batch_clear_btn: 'پاکسازی',
            batch_name_prefix: 'پیشوند نام دوربین‌ها',
            batch_name_prefix_placeholder: 'مثلاً دوربین، Camera',
            batch_default_location: 'موقعیت مکانی پیش‌فرض',
            batch_default_location_placeholder: 'مثلاً طبقه اول، لابی',
            batch_table_row: '#',
            batch_table_name: 'نام دوربین',
            batch_table_url: 'آدرس RTSP',
            batch_table_location: 'موقعیت مکانی',
            batch_table_remove: 'حذف',
            batch_no_cameras_parsed: 'هنوز هیچ آدرس RTSP معتبری شناسایی نشده است. لینک‌ها را در کادر بالا بچسبانید یا فایل txt بارگذاری کنید.',
            batch_detected_count: '{count} دوربین مجزا شناسایی شد',
            batch_import_submit: 'ثبت و افزودن همه {count} دوربین',
            batch_import_success: '{count} دوربین مجزا با موفقیت ثبت و اضافه شدند!',
            batch_importing: 'در حال ذخیره‌سازی و راه‌اندازی دوربین‌ها...',
            batch_err_no_cameras: 'حداقل یک آدرس RTSP معتبر باید وارد شود.',

            // Batch IP Range Generator
            batch_subtab_paste: '📋 چسباندن متن / فایل متنی',
            batch_subtab_ip_range: '🌐 بر اساس رنج آی‌پی (IP Range)',
            range_start_ip: 'آدرس IP شروع',
            range_start_ip_placeholder: 'مثلاً 192.168.0.10',
            range_end_ip: 'آدرس IP پایان',
            range_end_ip_placeholder: 'مثلاً 192.168.0.20 یا 20',
            range_generate_btn: '⚡ تولید و افزودن به لیست ({count} دوربین)',
            range_invalid_ips: 'لطفاً آدرس IP شروع و پایان معتبر وارد کنید.',
            range_end_smaller: 'آدرس IP پایان باید بزرگتر یا مساوی IP شروع باشد.',
            range_too_large: 'حداکثر ۲۵۶ دوربین در هر بار رنج IP قابل تولید است.',
            range_generated_toast: '{count} آدرس دوربین از رنج IP با موفقیت به لیست افزوده شد.',

            // Identities (Persons) Page
            persons_title: 'مدیریت هویت‌ها و پرسنل',
            add_person_btn: '＋ ثبت هویت جدید',
            loading_persons: 'در حال بارگذاری هویت‌ها...',
            no_persons_title: 'هیچ شخصی در سامانه تعریف نشده است',
            no_persons_desc: 'با بارگذاری عکس‌های پرسنل یا افراد مجاز، سیستم آن‌ها را در تصویر دوربین‌ها شناسایی می‌کند.',
            person_photos_count: 'عکس‌ها',
            person_enrolled_date: 'تاریخ ثبت',
            btn_add_photos: '📸 افزودن عکس',
            confirm_delete_person: 'آیا از حذف «{name}» اطمینان دارید؟ تمامی الگوهای چهره و تصاویر ذخیره شده پاک خواهند شد.',
            person_deleted_toast: '«{name}» از سامانه حذف شد.',
            no_role_assigned: 'بدون سمت مشخص',

            // Person Analytics & Summary Modal (Shift-Aware)
            btn_person_analytics: '📊 آمار و خلاصه عملکرد',
            person_analytics_title: '📊 آمار، حضور و خلاصه عملکرد — {name}',
            tab_overview: '📊 خلاصه و شاخص‌ها',
            tab_shifts: '⏰ شیفت‌ها و انضباط کاری',
            tab_timeline: '📈 الگوهای زمانی (۲۴ ساعت)',
            tab_cameras: '📹 پراکندگی دوربین‌ها',
            tab_attendance: '📅 تقویم حضور روزانه (۱۴ روز)',
            tab_recent: '🖼️ ترددهای اخیر',
            kpi_total_detections: 'مجموع ترددهای ثبت شده',
            kpi_today_detections: 'ترددهای امروز',
            kpi_first_seen: 'اولین ثبت در سامانه',
            kpi_last_seen: 'آخرین مشاهده',
            kpi_avg_confidence: 'میانگین دقت تطابق چهره',
            kpi_shift_compliance: 'درصد حضور در شیفت',
            kpi_alerts_count: 'هشدارهای امنیتی',
            kpi_absence_time: 'غیبت در ساعات شیفت',
            shift_time: 'ساعات شیفت کاری',
            shift_info_header: 'زمان‌بندی شیفت کاری تخصیص یافته',
            no_assigned_shift: 'هیچ شیفت یا منطقه‌ای برای این شخص تعریف نشده است.',
            shift_hours: 'ساعات شیفت:',
            shift_active_days: 'روزهای فعال شیفت:',
            shift_on_time_count: 'ورود به موقع',
            shift_late_count: 'تأخیر در ورود',
            shift_early_departure_count: 'خروج زودهنگام',
            shift_absent_days: 'غیبت در روزهای شیفت',
            shift_overtime_days: 'اضافه‌کاری / حضور مازاد',
            total_absence_duration: 'مجموع زمان غیبت از شیفت',
            today_absence: 'عدم حضور امروز',
            today_presence: 'مدت حضور امروز',
            absence_day: 'غیبت امروز (روزانه)',
            absence_week: 'غیبت این هفته (۷ روز)',
            absence_month: 'غیبت این ماه (۳۰ روز)',
            absence_breakdown_title: 'تفکیک مدت زمان غیبت از شیفت',
            absence_period_today: 'امروز',
            absence_period_week: 'هفته اخیر (۷ روز)',
            absence_period_month: 'ماه اخیر (۳۰ روز)',
            minutes_absent_now: '{mins} دقیقه غیبت از شیفت',
            absence_from_shift: 'غیبت از شیفت',
            no_absence: 'حضور کامل (۰ دقیقه)',
            th_absence: 'مدت غیبت از شیفت',
            shift_filter_all: 'همه ترددها (۲۴ ساعت)',
            shift_filter_in_shift: 'فقط ساعات شیفت',
            shift_filter_out_shift: 'خارج از ساعات شیفت / اضافه‌کاری',
            status_on_time: 'به موقع',
            status_late: 'تأخیر ({mins} دقیقه)',
            status_left_early: 'خروج زودتر ({mins} دقیقه)',
            status_overtime: 'اضافه‌کاری ({mins} دقیقه)',
            status_absent_day: 'غیبت در شیفت',
            status_rest_day: 'روز تعطیل / بدون شیفت',
            status_off_schedule: 'تردد خارج از برنامه',
            status_normal: 'عادی',
            th_date: 'تاریخ',
            th_day: 'روز',
            th_shift_hours: 'شیفت کاری',
            th_arrival: 'ورود (اولین مشاهده)',
            th_departure: 'خروج (آخرین مشاهده)',
            th_presence_span: 'مدت حضور',
            th_status: 'وضعیت انضباطی',
            th_detections: 'تعداد',
            th_camera: 'دوربین اصلی',
            hourly_chart_title: 'نمودار توزیع ترددهای شخص در ساعات شبانه‌روز (۰ الی ۲۳)',
            hourly_chart_hint: 'آبی = ترددهای ساعات شیفت | خاکستری = خارج از شیفت',
            hourly_peak: 'اوج فعالیت:',
            camera_breakdown_title: 'پراکندگی و فراوانی حضور در دوربین‌ها و موقعیت‌ها',
            print_summary: '🖨️ چاپ / ذخیره گزارش',
            search_persons_placeholder: 'جستجوی نام یا سمت...',
            sort_by: 'مرتب‌سازی:',
            sort_name: 'نام',
            sort_detections: 'بیشترین تردد',
            sort_last_seen: 'آخرین تردد',
            card_today_sightings: '{count} تردد امروز',
            card_total_sightings: '{count} کل ترددها',
            card_never_seen: 'بدون تردد ثبت شده',
            view_person_analytics: '📊 مشاهده آمار و خلاصه هویت',


            // Person Form Modal
            modal_add_person: 'ثبت شخص جدید',
            modal_add_photos: 'افزودن عکس‌های بیشتر — {name}',
            label_full_name: 'نام و نام خانوادگی',
            placeholder_full_name: 'مثلاً علی رضایی',
            label_role: 'سمت / عنوان سازمانی',
            placeholder_role: 'مثلاً کارمند، حراست، مدیر واحد، مهمان',
            label_ref_photos: 'عکس‌های مرجع چهره',
            label_add_more_photos: 'عکس‌های مرجع تکمیلی',
            upload_drag_text: 'برای انتخاب یا کشیدن عکس‌ها کلیک کنید',
            upload_hint_1: 'یک یا چند عکس واضح از چهره (JPG یا PNG) آپلود نمایید',
            upload_hint_2: 'تعداد بیشتر عکس با زوایای مختلف = افزایش دقت تشخیص',
            processing_photos: 'در حال پردازش و استخراج الگوی چهره...',
            person_enrolled_success: '«{name}» با موفقیت در سیستم ثبت شد!',
            photos_added_success: 'عکس‌های جدید با موفقیت اضافه شدند!',
            err_enter_name: 'لطفاً نام را وارد نمایید.',
            err_select_photo: 'لطفاً حداقل یک عکس چهره انتخاب کنید.',
            existing_photos_title: 'عکس‌های مرجع ذخیره‌شده ({count})',
            no_existing_photos: 'هنوز هیچ عکس مرجعی برای این شخص ذخیره نشده است.',
            delete_photo_confirm: 'آیا از حذف این عکس مرجع مطمئن هستید؟ الگوی شناسایی این عکس نیز حذف خواهد شد.',
            photo_deleted_success: 'عکس مرجع با موفقیت حذف شد.',
            btn_delete_photo: 'حذف این عکس',
            photos_remaining_count: '{count} عکس ثبت‌شده',
            add_more_photos_section: 'افزودن عکس‌های مرجع جدید',

            // Zone Monitoring & Shifts Page
            zones_title: '🎯 پایش منطقه‌ها و زمان‌بندی شیفت‌ها',
            subtab_board: '👥 تابلوی حضور زنده پرسنل',
            subtab_zones: '🎯 تخصیص منطقه‌ها و شیفت‌ها ({count})',
            subtab_logs: '📋 گزارش تخلفات و غیبت‌ها ({count})',
            total_active_zones: 'مجموع منطقه‌های فعال',
            staff_on_station: 'پرسنل حاضر در شیفت',
            absence_alerts: 'هشدارهای عدم حضور / غیبت',
            off_duty_stat: 'خارج از ساعت شیفت',
            badge_on_station: '🟢 حاضر در محل',
            badge_absent: '🔴 غایب / عدم حضور',
            badge_off_duty: '⚪ خارج از شیفت',
            timetable_shift: '🕐 زمان‌بندی و شیفت کاری',
            assigned_staff: 'پرسنل مسئول این منطقه:',
            no_staff_assigned: 'هیچ پرسنلی به این منطقه متصل نشده است.',
            edit_area_shift: '✏️ ویرایش منطقه و شیفت',
            no_zones_title: 'هیچ منطقه مهمی تعریف نشده است',
            no_zones_desc: 'با تعریف منطقه‌های نظارتی روی دوربین‌ها و اتصال پرسنل، حضور و شیفت کاری آن‌ها را به صورت زنده کنترل کنید.',
            manage_cameras_zones: 'مدیریت دوربین‌ها و منطقه‌ها',
            zone_list_header_title: '🎯 دوربین‌ها و منطقه‌های مشخص شده',
            zone_list_header_desc: 'محدوده‌های جغرافیایی تصویر را رسم کرده و پرسنل مربوطه و ساعات شیفت را مشخص کنید.',
            go_to_cameras: '📹 رفتن به دوربین‌ها',
            btn_manage_zones: '🎯 مدیریت منطقه‌ها ({count})',
            no_camera_zones: 'هنوز هیچ محدوده‌ای روی این دوربین تعریف نشده است.',
            attached_ids: 'شناسه‌های متصل: {ids}',
            no_logs_title: 'هیچ گزارش تخلفی ثبت نشده است',
            no_logs_desc: 'تاکنون هیچ تخلف غیبت، خروج از منطقه مجاز یا ورود غیرمجاز ثبت نشده است.',
            table_snapshot: 'تصویر چهره',
            table_time: 'زمان (محلی)',
            table_person: 'شخص',
            table_camera_area: 'دوربین و منطقه',
            table_violation: 'نوع هشدار / رویداد',

            // Zone Modal & Drawer
            zone_modal_title: '🎯 منطقه‌های مهم نظارتی — {name}',
            zone_canvas_hint: '📍 روی تصویر دوربین کلیک کرده و بکشید تا یک منطقه مشخص شود.',
            zone_add_title: '➕ افزودن / تنظیم منطقه',
            label_zone_name: 'نام منطقه',
            placeholder_zone_name: 'مثلاً میز کار، گیت ورودی، باجه ۱',
            label_attach_persons: 'انتساب افراد به این محدوده',
            no_enrolled_persons_hint: 'هنوز هویتی ثبت نشده است. ابتدا از منوی هویت‌ها افراد را اضافه کنید.',
            label_alert_policy: 'سیاست هشدار امنیتی',
            policy_absence: '🔔 هشدار در صورت عدم حضور شخص در این منطقه',
            policy_unauthorized: '🚨 هشدار در صورت ورود افراد غیرمجاز',
            policy_both: '⚠️ هر دو مورد (عدم حضور + ورود غیرمجاز)',
            label_shift_schedule: '🕐 ساعات پایش و شیفت کاری',
            label_start_time: 'ساعت شروع',
            label_end_time: 'ساعت پایان',
            btn_save_zone: '💾 ذخیره منطقه و شیفت',
            active_zones_count: '📋 منطقه‌های فعال ({count})',
            zone_drawn_toast: 'محدوده رسم شد! نام منطقه را وارد کرده و دکمه ذخیره را بزنید.',
            zone_saved_toast: '✅ منطقه «{name}» ذخیره شد!',
            zone_deleted_toast: 'منطقه مورد نظر حذف شد.',
            confirm_delete_zone: 'آیا از حذف این منطقه اطمینان دارید؟',
            err_zone_name: 'لطفاً نام منطقه را وارد کنید.',
            err_draw_box: 'لطفاً ابتدا یک کادر مستطیلی روی تصویر دوربین رسم کنید.',
            days_mon: 'دوشنبه',
            days_tue: 'سه‌شنبه',
            days_wed: 'چهارشنبه',
            days_thu: 'پنج‌شنبه',
            days_fri: 'جمعه',
            days_sat: 'شنبه',
            days_sun: 'یکشنبه',
            short_mon: 'د',
            short_tue: 'س',
            short_wed: 'چ',
            short_thu: 'پ',
            short_fri: 'ج',
            short_sat: 'ش',
            short_sun: 'ی',

            // Live Presence & Watchdog Statuses
            status_off_duty: 'خارج از شیفت (برنامه کاری)',
            status_in_zone_recent: 'حاضر در منطقه (هم‌اکنون)',
            status_in_zone_secs: 'حاضر در منطقه ({sec} ثانیه قبل)',
            status_missing_mins: 'عدم حضور (غایب از {mins} دقیقه پیش)',
            status_not_seen_yet: 'هنوز مشاهده نشده',
            days_all: 'تمام روزها',

            // Real-time Alerts & Notifications
            notification_absence_title: '⚠️ هشدار عدم حضور در شیفت',
            notification_absence_msg: '«{person}» در محدوده کاری «{zone}» حضور ندارد (غایب به مدت {time})',
            notification_camera_disconnected_title: '⚠️ هشدار قطعی دوربین',
            notification_camera_disconnected_msg: 'دوربین «{camera}» قطع است. پایش حضور «{person}» متوقف شد.',
            notification_unauthorized_title: '🚨 هشدار ورود غیرمجاز',
            notification_unauthorized_msg: 'ورود غیرمجاز «{person}» به منطقه «{zone}» در دوربین «{camera}»',
            notification_out_of_zone_title: '⚠️ هشدار خروج از محدوده',
            notification_out_of_zone_msg: '«{person}» خارج از منطقه مجاز در دوربین «{camera}»',
            notification_zone_event: '🔔 رویداد منطقه: «{person}» در منطقه «{zone}»',

            // Generic Error Messages
            err_failed_save: 'خطا در ذخیره‌سازی: {msg}',
            err_failed_delete: 'خطا در حذف: {msg}',
            err_failed_load: 'خطا در بارگذاری: {msg}',
            err_generic: 'خطا: {msg}',

            // Absence Duration Units
            absence_duration_pill: '⏱️ غیبت: {duration}',
            unit_seconds: '{s} ثانیه',
            unit_minutes: '{m} دقیقه',
            unit_hours_minutes: '{h} ساعت و {m} دقیقه',

            // System Settings
            settings_title: '⚙️ تنظیمات سیستم',
            settings_subtitle: 'پیکربندی هوشمند ذخیره‌سازی، شناسایی چهره و کارایی سیستم',
            setting_save_snapshots: 'ذخیره تصاویر اسنپ‌شات رویدادها',
            setting_save_snapshots_desc: 'در صورت غیرفعال بودن، رویدادها صرفاً در پایگاه‌داده (Database-Only) ثبت شده و فایل تصویری روی دیسک ذخیره نمی‌شود.',
            setting_save_snapshots_enabled: 'فعال (ذخیره تصویر روی دیسک و ثبت دیتابیس)',
            setting_save_snapshots_disabled: 'غیرفعال (صرفاً ثبت در پایگاه‌داده)',
            setting_log_unknown: 'ثبت و لاگ چهره‌های ناشناس',
            setting_log_unknown_desc: 'در صورت غیرفعال بودن، افراد ناشناس لاگ نمی‌شوند و صرفاً پرسنل و افراد دارای هویت در سیستم ثبت می‌گردند.',
            setting_log_unknown_enabled: 'فعال (ثبت تمام چهره‌ها - شناخته‌شده و ناشناس)',
            setting_log_unknown_disabled: 'غیرفعال (صرفاً ثبت افراد شناخته‌شده)',
            setting_cooldown: 'زمان خنک‌سازی کول‌داون (ثانیه)',
            setting_cooldown_desc: 'فاصله زمانی بین ثبت رویدادهای مجدد برای یک فرد یکسان در همان دوربین',
            setting_match_threshold: 'آستانه دقت تطبیق چهره',
            setting_match_threshold_desc: 'حداقل شباهت برای تأیید هویت فرد شناخته‌شده (بین ۰.۱ تا ۱.۰)',
            setting_frame_skip: 'نرخ پردازش فریم (Frame Skip)',
            setting_frame_skip_desc: 'پردازش یک فریم از هر N فریم برای بهینه‌سازی بار پردازشی سخت‌افزار',
            settings_saved_success: 'تنظیمات سیستم با موفقیت ذخیره و اعمال شد.',

            // Pagination
            pagination_showing: 'نمایش {from} تا {to} از مجموع {total} رویداد',
            pagination_prev: '« صفحه قبلی',
            pagination_next: 'صفحه بعدی »',
            pagination_page_of: 'صفحه {page} از {totalPages}',
            pagination_per_page: 'تعداد در صفحه:',
            pagination_load_more: 'بارگذاری رویدادهای بیشتر...',
            pagination_all_loaded: 'تمامی رویدادها نمایش داده شده‌اند.',

            // Time Relative
            just_now: 'هم‌اکنون',
            minutes_ago: '{mins} دقیقه پیش',
            hours_ago: '{hours} ساعت پیش',
            days_ago: '{days} روز پیش',

            // RBAC & Authentication (Persian)
            nav_users: 'کاربران و دسترسی‌ها',
            account_disabled: 'حساب کاربری شما غیرفعال شده است. لطفاً با مدیر سیستم تماس بگیرید.',
            auth_login_title: 'ورود به سامانه پایش و تردد',
            auth_login_subtitle: 'سیستم هوشمند تشخیص چهره و نظارت کارخانه',
            auth_username: 'نام کاربری',
            auth_username_placeholder: 'نام کاربری خود را وارد کنید',
            auth_password: 'رمز عبور',
            auth_password_placeholder: '••••••••',
            auth_remember_me: 'مرا به خاطر بسپار',
            auth_login_btn: 'ورود به سامانه',
            auth_logging_in: 'در حال احراز هویت...',
            auth_err_empty: 'لطفاً نام کاربری و رمز عبور را وارد نمایید.',
            auth_err_invalid: 'نام کاربری یا رمز عبور اشتباه است.',
            auth_err_inactive: 'حساب کاربری شما غیرفعال شده است.',
            auth_change_pw_title: 'تغییر رمز عبور',
            auth_current_pw: 'رمز عبور فعلی',
            auth_new_pw: 'رمز عبور جدید',
            auth_confirm_pw: 'تکرار رمز عبور جدید',
            auth_pw_mismatch: 'رمز عبور جدید و تکرار آن یکسان نیستند.',
            auth_pw_min_length: 'رمز عبور باید حداقل ۶ کاراکتر باشد.',
            auth_pw_changed_success: 'رمز عبور با موفقیت تغییر یافت.',
            auth_logout: 'خروج از حساب',
            auth_profile: 'پروفایل من',
            auth_change_pw_menu: 'تغییر رمز عبور',

            // Users & Roles Management (Persian)
            users_title: 'مدیریت کاربران و سطوح دسترسی',
            users_subtitle: 'مدیریت حساب‌های کاربری، نقش‌ها و ماتریس مجوزهای بخش‌های سامانه',
            tab_users: 'کاربران سامانه',
            tab_roles: 'نقش‌ها و دسترسی‌ها',
            btn_add_user: '＋ افزودن کاربر جدید',
            btn_add_role: '＋ ایجاد نقش جدید',
            col_user: 'کاربر',
            col_role: 'نقش سازمانی',
            col_status: 'وضعیت',
            col_last_login: 'آخرین ورود',
            col_created: 'تاریخ ایجاد',
            col_actions: 'عملیات',
            role_assigned_count: '{count} کاربر منتسب',
            system_role_tag: 'سیستمی',
            custom_role_tag: 'سفارشی',
            modal_add_user: 'افزودن کاربر',
            modal_edit_user: 'ویرایش کاربر',
            user_fullname: 'نام و نام خانوادگی',
            user_fullname_placeholder: 'مثال: علیرضا محمدی',
            user_role_select: 'نقش کاربری',
            user_status_active: 'فعال (امکان ورود به سامانه)',
            modal_add_role: 'تعریف نقش جدید',
            modal_edit_role: 'ویرایش نقش و مجوزها',
            role_identifier: 'شناسه سیستمی نقش (انگلیسی)',
            role_identifier_placeholder: 'e.g., floor_supervisor',
            role_display_name: 'عنوان نمایشی نقش',
            role_display_name_placeholder: 'مثال: سرپرست سالن مونتاژ',
            role_description: 'توضیحات و کاربرد نقش',
            role_description_placeholder: 'وظایف و محدوده دسترسی این نقش...',
            role_permissions_title: 'ماتریس مجوزهای بخش‌های سامانه',
            role_permissions_desc: 'مجوزهای مجاز برای اعضای این نقش را انتخاب کنید:',
            select_all: 'انتخاب همه',
            deselect_all: 'لغو انتخاب همه',
            btn_reset_pw: 'بازنشانی رمز',
            confirm_delete_user: 'آیا از حذف کاربر "{name}" اطمینان دارید؟',
            confirm_delete_role: 'آیا از حذف نقش "{name}" اطمینان دارید؟',
            user_created_success: 'کاربر با موفقیت ایجاد شد.',
            user_updated_success: 'اطلاعات کاربر بروزرسانی شد.',
            user_deleted_success: 'کاربر با موفقیت حذف شد.',
            role_created_success: 'نقش با موفقیت ایجاد شد.',
            role_updated_success: 'نقش و دسترسی‌ها بروزرسانی شدند.',
            role_deleted_success: 'نقش با موفقیت حذف شد.',
            pw_reset_success: 'رمز عبور کاربر با موفقیت تغییر کرد.',
            err_cannot_delete_self: 'نمی‌توانید حساب کاربری خودتان را حذف کنید.',
            err_cannot_delete_system_role: 'نقش‌های پیش‌فرض سیستمی قابل حذف نیستند.',

            // Direct Aliases for Auth & Users Pages
            login: 'ورود به سامانه',
            login_title: 'سامانه نظارت تصویری هوشمند',
            login_subtitle: 'لطفاً برای دسترسی به سامانه، نام کاربری و کلمه عبور خود را وارد نمایید',
            username: 'نام کاربری',
            username_placeholder: 'نام کاربری خود را وارد نمایید',
            password: 'کلمه عبور',
            password_placeholder: 'کلمه عبور خود را وارد نمایید',
            login_btn: 'ورود به سیستم',
            logging_in: 'در حال اعتبارسنجی...',
            invalid_credentials: 'نام کاربری یا کلمه عبور نادرست است.',
            login_success: 'ورود با موفقیت انجام شد',
            logout: 'خروج از حساب',
            logout_success: 'با موفقیت از سیستم خارج شدید',
            session_expired: 'نشست کاربری شما منقضی شده است. لطفاً مجدداً وارد شوید.',
            access_denied: 'شما دسترسی لازم به این بخش را ندارید.',
            change_password: 'تغییر کلمه عبور',
            change_password_subtitle: 'برای حفظ امنیت حساب کاربری، کلمه عبور فعلی و جدید خود را وارد نمایید',
            current_password: 'کلمه عبور فعلی',
            current_password_placeholder: 'کلمه عبور فعلی را وارد نمایید',
            new_password: 'کلمه عبور جدید',
            new_password_placeholder: 'کلمه عبور جدید (حداقل ۴ کاراکتر)',
            confirm_new_password: 'تکرار کلمه عبور جدید',
            confirm_new_password_placeholder: 'تکرار کلمه عبور جدید را وارد نمایید',
            passwords_dont_match: 'کلمه عبور جدید و تکرار آن یکسان نیستند.',
            passwords_do_not_match: 'کلمه عبور جدید و تکرار آن یکسان نیستند.',
            password_min_length: 'کلمه عبور باید حداقل ۴ کاراکتر باشد.',
            password_changed_success: 'کلمه عبور با موفقیت تغییر یافت.',
            password_reset_success: 'کلمه عبور کاربر با موفقیت بازنشانی شد.',
            confirm_reset: 'ثبت کلمه عبور جدید',
            saving: 'در حال ذخیره...',
            show_password: 'نمایش کلمه عبور',
            hide_password: 'مخفی کردن کلمه عبور',
            add_user: 'افزودن کاربر',
            add_role: 'نقش جدید',
            add_user_sub: 'مشخصات حساب کاربری و نقش آن را مشخص نمایید',
            add_role_sub: 'سطوح دسترسی این نقش را در بخش‌های مختلف مشخص نمایید',
            edit_user: 'ویرایش کاربر',
            edit_role: 'ویرایش نقش و دسترسی‌ها',
            edit_role_permissions: 'ویرایش دسترسی‌ها',
            role: 'نقش سازمانی',
            role_desc: 'شرح وظایف و اختیارات',
            roles: 'نقش‌ها',
            status: 'وضعیت',
            last_login: 'آخرین ورود',
            actions: 'عملیات',
            custom_permissions: 'دسترسی‌های اختصاصی',
            custom_permissions_override: 'دسترسی‌های اختصاصی اضافه بر نقش',
            custom_perms_hint: 'این دسترسی‌ها علاوه بر دسترسی‌های نقش به کاربر اعطا خواهند شد',
            fullname: 'نام و نام خانوادگی',
            user_active_toggle: 'حساب کاربری فعال باشد',
            new_password_optional: 'کلمه عبور جدید (اختیاری)',
            system_role: 'سیستمی',
            custom_role: 'سفارشی',
            all_permissions: 'دسترسی کامل به تمامی بخش‌ها (*)',
            no_description: 'بدون توضیحات',
            never_logged_in: 'هنوز وارد نشده',
            reset_password: 'بازنشانی کلمه عبور',
            error_loading_data: 'خطا در بارگذاری اطلاعات کاربران و نقش‌ها',
            err_failed_load: 'خطا در بارگذاری: {msg}',
            permissions: 'سطوح دسترسی',
            users: 'کاربر',
        },

        en: {
            // Brand & Navigation
            brand_name: 'FaceTrack',
            brand_subtitle: 'Detection System',
            nav_dashboard: 'Dashboard',
            nav_duty: 'Live Duty',
            nav_zones: 'Zones & Shifts',
            nav_cameras: 'Cameras',
            nav_persons: 'Identities',
            nav_settings: 'Settings',
            ws_connected: 'Connected',
            ws_reconnecting: 'Reconnecting...',
            ws_connecting: 'Connecting...',
            lang_switcher_label: 'Language',

            // Live Duty Screen
            duty_title: '⏱️ Live Duty Roster & Shift Absence Monitoring',
            duty_subtitle: 'Real-time tracking of staff on duty, current zone absence, and cumulative shift absence',
            kpi_staff_on_duty: 'Staff in Duty Hours',
            kpi_on_station: 'Present in Zone',
            kpi_absent_now: 'Absent from Zone',
            kpi_total_shift_absence: 'Total Shift Absence',
            kpi_total_absence_incidents: 'Total Absence Incidents',
            kpi_avg_compliance: 'Avg Shift Compliance',
            filter_all_duty: 'All on Duty',
            filter_present: '🟢 Present in Zone',
            filter_absent: '🔴 Absent from Zone',
            toggle_only_active: 'Active Duty Hours Only',
            auto_refresh_badge: 'Auto-refresh: {sec}s',
            shift_window_badge: 'Shift Window: {window}',
            current_absence_badge: '⏱️ Current Absence: {time}',
            current_absence_title: 'Current Absence (Not in Zone)',
            sum_shift_absence_title: 'Sum of Current Shift Absence',
            sum_shift_absence_desc: '{absent} absent of {elapsed} elapsed',
            absence_count_badge: '{count} absence incidents this shift',
            absence_count_short: '{count} absence times',
            absence_windows_btn: 'Absence Windows ({count})',
            absence_windows_title: 'Absence Time Windows',
            no_absence_intervals: 'No absence incidents in this shift',
            interval_type_late_arrival: 'Late Arrival',
            interval_type_gap: 'Left Zone',
            interval_type_current: 'Currently Missing',
            interval_type_unseen: 'Never Seen Yet',
            interval_type_early_leave: 'Left Early',
            window_now: 'Now',
            in_zone_present: '🟢 Present on Station',
            in_zone_ago: 'Present (seen {sec}s ago)',
            absent_missing_mins: '🔴 Absent from Zone ({mins}m)',
            absent_not_seen: '🔴 Absent Since Shift Start',
            compliance_rate_label: 'Shift Presence: {pct}%',
            no_duty_title: 'No Personnel in Duty Hours Right Now',
            no_duty_desc: 'No staff members have an active shift timetable scheduled for this time, or shift hours have ended.',

            // Common / Actions
            live: 'LIVE',
            close: 'Close',
            cancel: 'Cancel',
            save: 'Save',
            save_changes: 'Save Changes',
            delete: 'Delete',
            edit: 'Edit',
            test: 'Test',
            refresh: 'Refresh',
            active: 'Active',
            inactive: 'Inactive',
            online: 'Online',
            disconnected: 'Disconnected',
            loading: 'Loading...',
            unknown: 'Unknown',
            unidentified: 'Unidentified Face',
            known: 'Known',
            known_identity: 'Known Identity',
            none: 'None',
            all: 'All',
            details: 'Details',
            search: 'Search',
            view_grid: 'Grid View',
            view_list: 'List View',

            // Dashboard
            dashboard_title: 'Dashboard',
            stat_total_today: 'Total Events Today',
            stat_known_today: 'Known Faces',
            stat_unknown_today: 'Unknown Faces',
            stat_active_cameras: 'Active Cameras',
            filter_all: 'All Events',
            filter_known: '✅ Known',
            filter_unknown: '❓ Unknown',
            mode_stream: '📜 Activity Stream',
            mode_grouped: '👥 Group by Person',
            no_events_title: 'No events yet',
            no_events_desc: 'Detection events will appear here in real-time once cameras are active and face detection is running.',
            no_grouped_title: 'No categorized events',
            no_grouped_desc: 'No person detection events recorded yet.',
            failed_load_events: 'Failed to load events',
            detections_count: '{count} Detections',
            latest_time: 'Latest: {time}',

            // Event Details Modal & Card
            event_details_title: '🎯 Event #{id}',
            event_camera: 'Camera Source',
            event_area: 'Area',
            event_timestamp: 'Timestamp (Local Time)',
            event_confidence: 'Matching Confidence',
            event_person_identity: 'Person Identity',
            enroll_person: '➕ Enroll Person',
            view_persons: '👤 View Persons',
            alert_out_of_zone: '⚠️ Out of Area',
            alert_unauthorized: '🚨 Unauthorized',
            alert_absence_timeout: '⏱️ Absence Timeout',
            alert_camera_disconnected: '⚠️ Camera Disconnected',
            filter_camera_offline: 'Camera Offline',
            badge_camera_offline: '🟡 Camera Disconnected',
            status_camera_offline: 'Camera Disconnected',
            camera_feed_unavailable: 'No camera video signal',
            kpi_camera_offline_title: 'Cameras Offline',
            duty_camera_disconnected_badge: '{count} Cam Offline',
            other_detections_for: '📸 Other Detections for {name} ({count})',
            click_to_view: 'Click for details',
            no_image: 'No Image',

            // Cameras Page
            cameras_title: 'Camera Management',
            add_camera_btn: '＋ Add Camera',
            loading_cameras: 'Loading cameras...',
            no_cameras_title: 'No cameras configured',
            no_cameras_desc: 'Add your first IP camera to start detecting faces. Click "Add Camera" above to get started.',
            camera_live_stream: 'Live Stream',
            camera_zones_btn: 'Zones',
            camera_test_btn: '⚡ Test',
            camera_edit_btn: '✏️ Edit',
            camera_delete_btn: 'Delete',
            camera_location: 'Location:',
            camera_added: 'Added {date}',
            confirm_delete_camera: 'Delete camera "{name}"? This will stop its stream and remove all settings.',
            camera_deleted_toast: 'Camera "{name}" deleted.',
            testing_connection: 'Testing connection...',
            test_success: '✅ Camera connection successful!',
            test_failed: '❌ Camera connection failed',
            camera_saved_success: 'Camera updated successfully!',
            camera_added_success: 'Camera added successfully!',
            refresh_snapshot: '🔄 Refresh Snapshot',
            full_resolution: '🔗 Full Resolution',

            // Camera Form Modal
            modal_add_camera: 'Add Camera',
            modal_edit_camera: 'Edit Camera',
            label_camera_name: 'Camera Name',
            placeholder_camera_name: 'e.g., Front Door Camera',
            label_rtsp_url: 'RTSP URL',
            placeholder_rtsp_url: 'rtsp://user:pass@192.168.1.100:554/stream',
            label_location: 'Location',
            placeholder_location: 'e.g., Main Entrance, Parking Lot',
            label_active: 'Active',
            btn_test_connection: '⚡ Test Connection',

            // Camera Tabs & Creation Modes
            tab_camera_direct: 'Direct RTSP Link',
            tab_camera_builder: 'IP & Credentials Builder',
            tab_camera_batch: 'Batch Import (Multiple)',

            // RTSP URL Builder
            builder_ip: 'Camera IP Address',
            builder_ip_placeholder: 'e.g., 192.168.1.100',
            builder_port: 'RTSP Port',
            builder_port_placeholder: '554',
            builder_username: 'Username (Optional)',
            builder_username_placeholder: 'admin',
            builder_password: 'Password (Optional)',
            builder_password_placeholder: 'password',
            builder_preset: 'Stream Brand / Preset',
            preset_generic: 'Generic RTSP (/h264Preview_01_main)',
            preset_hikvision_main: 'Hikvision Main (/Streaming/Channels/101)',
            preset_hikvision_sub: 'Hikvision Sub (/Streaming/Channels/102)',
            preset_dahua_main: 'Dahua Main (/cam/realmonitor?channel=1&subtype=0)',
            preset_dahua_sub: 'Dahua Sub (/cam/realmonitor?channel=1&subtype=1)',
            preset_uniview: 'Uniview (/media/video1)',
            preset_custom: 'Custom Path (Type below)',
            builder_path: 'Stream Path',
            builder_path_placeholder: 'e.g., /live/ch0 or /stream1',
            builder_preview: 'Generated RTSP URL Preview',
            builder_copy: 'Copy URL',
            builder_copied: 'URL Copied!',

            // Batch Camera Import
            batch_import_desc: 'Paste RTSP links below (one per line) or upload a .txt file containing the list. Each camera will be added and operated as an individual camera.',
            batch_paste_label: 'RTSP URLs (one per line)',
            batch_upload_btn: '📁 Upload .TXT File',
            batch_clear_btn: 'Clear',
            batch_name_prefix: 'Camera Name Prefix',
            batch_name_prefix_placeholder: 'e.g., Camera, Entrance',
            batch_default_location: 'Default Location',
            batch_default_location_placeholder: 'e.g., Floor 1, Lobby',
            batch_table_row: '#',
            batch_table_name: 'Camera Name',
            batch_table_url: 'RTSP URL',
            batch_table_location: 'Location',
            batch_table_remove: 'Remove',
            batch_no_cameras_parsed: 'No valid RTSP links detected yet. Paste links in the box above or upload a .txt file.',
            batch_detected_count: '{count} individual camera(s) detected',
            batch_import_submit: 'Import All {count} Cameras',
            batch_import_success: '{count} cameras imported successfully!',
            batch_importing: 'Saving and starting cameras...',
            batch_err_no_cameras: 'Please provide at least one valid RTSP link.',

            // Batch IP Range Generator
            batch_subtab_paste: '📋 Paste / .TXT File',
            batch_subtab_ip_range: '🌐 IP Range Generator',
            range_start_ip: 'Start IP Address',
            range_start_ip_placeholder: 'e.g., 192.168.0.10',
            range_end_ip: 'End IP Address',
            range_end_ip_placeholder: 'e.g., 192.168.0.20 or 20',
            range_generate_btn: '⚡ Generate & Add to List ({count} Cameras)',
            range_invalid_ips: 'Please enter valid Start and End IP addresses.',
            range_end_smaller: 'End IP must be greater than or equal to Start IP.',
            range_too_large: 'Maximum 256 cameras can be generated per IP range.',
            range_generated_toast: '{count} camera URLs generated from IP range successfully!',

            // Identities (Persons) Page
            persons_title: 'Identity Management',
            add_person_btn: '＋ Add Person',
            loading_persons: 'Loading identities...',
            no_persons_title: 'No known persons enrolled',
            no_persons_desc: 'Add known individuals by uploading their reference photos. The system will then recognize them automatically in camera feeds.',
            person_photos_count: 'Photos',
            person_enrolled_date: 'Enrolled',
            btn_add_photos: '📸 Add Photos',
            confirm_delete_person: 'Delete "{name}"? This will remove all their reference photos and embeddings.',
            person_deleted_toast: '"{name}" has been removed.',
            no_role_assigned: 'No role assigned',

            // Person Analytics & Summary Modal (Shift-Aware)
            btn_person_analytics: '📊 Analytics & Summary',
            person_analytics_title: '📊 Analytics, Attendance & Summary — {name}',
            tab_overview: '📊 Overview & KPIs',
            tab_shifts: '⏰ Shifts & Punctuality',
            tab_timeline: '📈 24h Activity Patterns',
            tab_cameras: '📹 Camera Breakdown',
            tab_attendance: '📅 14-Day Attendance Log',
            tab_recent: '🖼️ Recent Sightings',
            kpi_total_detections: 'Total Detections',
            kpi_today_detections: 'Detections Today',
            kpi_first_seen: 'First Seen in System',
            kpi_last_seen: 'Last Seen',
            kpi_avg_confidence: 'Avg Match Confidence',
            kpi_shift_compliance: 'Shift Compliance',
            kpi_alerts_count: 'Security Alerts',
            kpi_absence_time: 'Shift Absence Time',
            shift_time: 'Shift Time',
            shift_info_header: 'Assigned Shift Timetable',
            no_assigned_shift: 'No specific shift or zone assigned to this person.',
            shift_hours: 'Shift Hours:',
            shift_active_days: 'Shift Active Days:',
            shift_on_time_count: 'On-Time Arrivals',
            shift_late_count: 'Late Arrivals',
            shift_early_departure_count: 'Early Departures',
            shift_absent_days: 'Absent Shift Days',
            shift_overtime_days: 'Overtime / Extra Duty',
            total_absence_duration: 'Total Shift Absence',
            today_absence: 'Today Absence',
            today_presence: 'Today Presence',
            absence_day: 'Today Absence',
            absence_week: 'Weekly Absence (7 Days)',
            absence_month: 'Monthly Absence (30 Days)',
            absence_breakdown_title: 'Shift Absence Breakdown (Day / Week / Month)',
            absence_period_today: 'Today',
            absence_period_week: 'Past 7 Days (Week)',
            absence_period_month: 'Past 30 Days (Month)',
            minutes_absent_now: '{mins}m absent from shift',
            absence_from_shift: 'Shift Absence',
            no_absence: 'Full Presence (0m)',
            th_absence: 'Shift Absence',
            shift_filter_all: 'All Sightings (24h)',
            shift_filter_in_shift: 'In-Shift Hours Only',
            shift_filter_out_shift: 'Outside Shift / Overtime',
            status_on_time: 'On Time',
            status_late: 'Late ({mins}m)',
            status_left_early: 'Left Early ({mins}m)',
            status_overtime: 'Overtime ({mins}m)',
            status_absent_day: 'Absent on Shift',
            status_rest_day: 'Rest Day / No Shift',
            status_off_schedule: 'Off-Schedule Activity',
            status_normal: 'Normal',
            th_date: 'Date',
            th_day: 'Day',
            th_shift_hours: 'Scheduled Shift',
            th_arrival: 'First Seen (Arrival)',
            th_departure: 'Last Seen (Departure)',
            th_presence_span: 'Presence Span',
            th_status: 'Punctuality Status',
            th_detections: 'Detections',
            th_camera: 'Primary Camera',
            hourly_chart_title: '24-Hour Activity Frequency (Hours 00 to 23)',
            hourly_chart_hint: 'Blue = In-Shift Activity | Grey = Outside Shift',
            hourly_peak: 'Peak Activity:',
            camera_breakdown_title: 'Camera & Location Distribution',
            print_summary: '🖨️ Print / Save Summary',
            search_persons_placeholder: 'Search name or role...',
            sort_by: 'Sort by:',
            sort_name: 'Name',
            sort_detections: 'Most Detections',
            sort_last_seen: 'Last Seen',
            card_today_sightings: '{count} today',
            card_total_sightings: '{count} total',
            card_never_seen: 'No detections recorded',
            view_person_analytics: '📊 View Person Analytics',


            // Person Form Modal
            modal_add_person: 'Add Known Person',
            modal_add_photos: 'Add Photos — {name}',
            label_full_name: 'Full Name',
            placeholder_full_name: 'e.g., John Doe',
            label_role: 'Role / Title',
            placeholder_role: 'e.g., Employee, Visitor, Security',
            label_ref_photos: 'Reference Photos',
            label_add_more_photos: 'Additional Reference Photos',
            upload_drag_text: 'Click or drag photos here',
            upload_hint_1: 'Upload 1 or more clear face photos (JPG, PNG)',
            upload_hint_2: 'More photos = better recognition accuracy',
            processing_photos: 'Processing photos...',
            person_enrolled_success: '{name} has been enrolled successfully!',
            photos_added_success: 'Photos added successfully!',
            err_enter_name: 'Please enter a name.',
            err_select_photo: 'Please upload at least one reference photo.',
            existing_photos_title: 'Saved Reference Photos ({count})',
            no_existing_photos: 'No reference photos saved for this person yet.',
            delete_photo_confirm: 'Are you sure you want to delete this reference photo? Its face embedding will also be removed.',
            photo_deleted_success: 'Reference photo removed successfully.',
            btn_delete_photo: 'Delete this photo',
            photos_remaining_count: '{count} saved photo(s)',
            add_more_photos_section: 'Add New Reference Photos',

            // Zone Monitoring & Shifts Page
            zones_title: '🎯 Zone Monitoring & Shift Schedules',
            subtab_board: '👥 Live Presence Board',
            subtab_zones: '🎯 Zone Assignments & Shifts ({count})',
            subtab_logs: '📋 Security & Absence Logs ({count})',
            total_active_zones: 'Total Active Zones',
            staff_on_station: 'Staff On Station (Present)',
            absence_alerts: 'Absence / Missing Alerts',
            off_duty_stat: 'Off-Duty (Outside Shift)',
            badge_on_station: '🟢 ON STATION',
            badge_absent: '🔴 ABSENT / MISSING',
            badge_off_duty: '⚪ OFF DUTY',
            timetable_shift: '🕐 Timetable Shift',
            assigned_staff: 'Assigned Staff:',
            no_staff_assigned: 'No staff attached to this area.',
            edit_area_shift: '✏️ Edit Area & Shift',
            no_zones_title: 'No Important Areas Defined',
            no_zones_desc: 'Create camera zones and attach staff to track live presence and shift timetables.',
            manage_cameras_zones: 'Manage Cameras & Zones',
            zone_list_header_title: '🎯 Cameras & Designated Areas',
            zone_list_header_desc: 'Define spatial regions of interest, attach identities, and configure shift timetables.',
            go_to_cameras: '📹 Go to Cameras',
            btn_manage_zones: '🎯 Manage Zones ({count})',
            no_camera_zones: 'No areas created on this camera yet.',
            attached_ids: 'Attached IDs: {ids}',
            no_logs_title: 'No Zone Violation Logs',
            no_logs_desc: 'No absence timeouts, out-of-zone violations, or unauthorized entries recorded yet.',
            table_snapshot: 'Snapshot',
            table_time: 'Time (Local)',
            table_person: 'Person',
            table_camera_area: 'Camera & Area',
            table_violation: 'Alert / Violation Type',

            // Zone Modal & Drawer
            zone_modal_title: '🎯 Important Areas (Zones) — {name}',
            zone_canvas_hint: '📍 Click and drag on the camera image to draw a designated area.',
            zone_add_title: '➕ Add / Configure Area',
            label_zone_name: 'Area Name',
            placeholder_zone_name: 'e.g. Work Desk, Reception Counter, Station 1',
            label_attach_persons: 'Attach Person(s) to this Area',
            no_enrolled_persons_hint: 'No enrolled persons yet. Add people in Identities page first.',
            label_alert_policy: 'Notification Policy',
            policy_absence: '🔔 Alert if attached person is NOT in this area',
            policy_unauthorized: '🚨 Alert if unauthorized person enters this area',
            policy_both: '⚠️ Both (Absence + Unauthorized entry)',
            label_shift_schedule: '🕐 Shift Timetable (Active Monitoring Hours)',
            label_start_time: 'Start Time',
            label_end_time: 'End Time',
            btn_save_zone: '💾 Save Area & Timetable',
            active_zones_count: '📋 Active Areas ({count})',
            zone_drawn_toast: 'Area drawn! Enter area name and click Save.',
            zone_saved_toast: '✅ Area "{name}" saved!',
            zone_deleted_toast: 'Area removed.',
            confirm_delete_zone: 'Remove this designated area?',
            err_zone_name: 'Please enter an area name.',
            err_draw_box: 'Please draw a rectangular area on the camera image first.',
            days_mon: 'Monday',
            days_tue: 'Tuesday',
            days_wed: 'Wednesday',
            days_thu: 'Thursday',
            days_fri: 'Friday',
            days_sat: 'Saturday',
            days_sun: 'Sunday',
            short_mon: 'Mon',
            short_tue: 'Tue',
            short_wed: 'Wed',
            short_thu: 'Thu',
            short_fri: 'Fri',
            short_sat: 'Sat',
            short_sun: 'Sun',

            // Live Presence & Watchdog Statuses
            status_off_duty: 'Off Duty (Outside Timetable)',
            status_in_zone_recent: 'In Zone (just now)',
            status_in_zone_secs: 'In Zone (seen {sec}s ago)',
            status_missing_mins: 'Missing for {mins}m',
            status_not_seen_yet: 'Not Seen Yet',
            days_all: 'All Days',

            // Real-time Alerts & Notifications
            notification_absence_title: '⚠️ Absence Alert',
            notification_absence_msg: '{person} is NOT in assigned area \'{zone}\' ({time})',
            notification_camera_disconnected_title: '⚠️ Camera Offline Alert',
            notification_camera_disconnected_msg: 'Camera \'{camera}\' is offline. Presence monitoring suspended for {person}.',
            notification_unauthorized_title: '🚨 Unauthorized Entry',
            notification_unauthorized_msg: '{person} in restricted area \'{zone}\' on camera \'{camera}\'',
            notification_out_of_zone_title: '⚠️ Out of Area Alert',
            notification_out_of_zone_msg: '{person} outside assigned zone on camera \'{camera}\'',
            notification_zone_event: '🔔 Zone Event: {person} in \'{zone}\'',

            // Generic Error Messages
            err_failed_save: 'Failed to save: {msg}',
            err_failed_delete: 'Failed to delete: {msg}',
            err_failed_load: 'Failed to load: {msg}',
            err_generic: 'Error: {msg}',

            // Absence Duration Units
            absence_duration_pill: '⏱️ Absent: {duration}',
            unit_seconds: '{s}s',
            unit_minutes: '{m} mins',
            unit_hours_minutes: '{h}h {m}m',

            // System Settings
            settings_title: '⚙️ System Settings',
            settings_subtitle: 'Configure snapshot storage, recognition thresholds, and performance',
            setting_save_snapshots: 'Save Event Snapshot Images',
            setting_save_snapshots_desc: 'When disabled, events are logged exclusively to the database (Database-Only) without writing image files to disk.',
            setting_save_snapshots_enabled: 'Enabled (Disk & Database)',
            setting_save_snapshots_disabled: 'Disabled (Database Only)',
            setting_log_unknown: 'Log Unknown Persons',
            setting_log_unknown_desc: 'When disabled, unidentified faces are ignored and only registered personnel with known profiles are logged.',
            setting_log_unknown_enabled: 'Enabled (Log All Faces - Known & Unknown)',
            setting_log_unknown_disabled: 'Disabled (Registered Persons Only)',
            setting_cooldown: 'Event Cooldown (Seconds)',
            setting_cooldown_desc: 'Minimum time between duplicate event logs for the same person on a camera',
            setting_match_threshold: 'Face Match Threshold',
            setting_match_threshold_desc: 'Minimum similarity score to match known identity (0.1 to 1.0)',
            setting_frame_skip: 'Frame Skip Rate',
            setting_frame_skip_desc: 'Process 1 frame every N frames for performance optimization',
            settings_saved_success: 'System settings updated and applied successfully.',

            // Pagination
            pagination_showing: 'Showing {from} to {to} of {total} events',
            pagination_prev: '« Previous',
            pagination_next: 'Next »',
            pagination_page_of: 'Page {page} of {totalPages}',
            pagination_per_page: 'Per page:',
            pagination_load_more: 'Load More Events...',
            pagination_all_loaded: 'All events have been loaded.',

            // Time Relative
            just_now: 'Just now',
            minutes_ago: '{mins}m ago',
            hours_ago: '{hours}h ago',
            days_ago: '{days}d ago',

            // RBAC & Authentication (English)
            nav_users: 'Users & Permissions',
            account_disabled: 'Your account is disabled. Please contact the system administrator.',
            auth_login_title: 'Sign In to Surveillance System',
            auth_login_subtitle: 'Intelligent Facial Recognition & Access Control',
            auth_username: 'Username',
            auth_username_placeholder: 'Enter your username',
            auth_password: 'Password',
            auth_password_placeholder: '••••••••',
            auth_remember_me: 'Remember Me',
            auth_login_btn: 'Sign In',
            auth_logging_in: 'Authenticating...',
            auth_err_empty: 'Please enter both username and password.',
            auth_err_invalid: 'Invalid username or password.',
            auth_err_inactive: 'Your account has been deactivated.',
            auth_change_pw_title: 'Change Password',
            auth_current_pw: 'Current Password',
            auth_new_pw: 'New Password',
            auth_confirm_pw: 'Confirm New Password',
            auth_pw_mismatch: 'New passwords do not match.',
            auth_pw_min_length: 'Password must be at least 6 characters.',
            auth_pw_changed_success: 'Password changed successfully.',
            auth_logout: 'Log Out',
            auth_profile: 'My Profile',
            auth_change_pw_menu: 'Change Password',

            // Users & Roles Management (English)
            users_title: 'User & Access Control',
            users_subtitle: 'Manage user accounts, roles, and granular surveillance permissions',
            tab_users: 'System Users',
            tab_roles: 'Roles & Permissions',
            btn_add_user: '＋ Add New User',
            btn_add_role: '＋ Create New Role',
            col_user: 'User',
            col_role: 'Role',
            col_status: 'Status',
            col_last_login: 'Last Login',
            col_created: 'Created',
            col_actions: 'Actions',
            role_assigned_count: '{count} assigned user(s)',
            system_role_tag: 'System',
            custom_role_tag: 'Custom',
            modal_add_user: 'Add User',
            modal_edit_user: 'Edit User',
            user_fullname: 'Full Name',
            user_fullname_placeholder: 'e.g. John Doe',
            user_role_select: 'User Role',
            user_status_active: 'Active (Allowed to sign in)',
            modal_add_role: 'Create New Role',
            modal_edit_role: 'Edit Role & Permissions',
            role_identifier: 'System Role Identifier (English)',
            role_identifier_placeholder: 'e.g., floor_supervisor',
            role_display_name: 'Display Name',
            role_display_name_placeholder: 'e.g., Assembly Floor Supervisor',
            role_description: 'Description & Scope',
            role_description_placeholder: 'Duties and authorized access boundaries...',
            role_permissions_title: 'Granular Permissions Matrix',
            role_permissions_desc: 'Select authorized permissions for members of this role:',
            select_all: 'Select All',
            deselect_all: 'Deselect All',
            btn_reset_pw: 'Reset Password',
            confirm_delete_user: 'Are you sure you want to delete user "{name}"?',
            confirm_delete_role: 'Are you sure you want to delete role "{name}"?',
            user_created_success: 'User created successfully.',
            user_updated_success: 'User details updated successfully.',
            user_deleted_success: 'User deleted successfully.',
            role_created_success: 'Role created successfully.',
            role_updated_success: 'Role & permissions updated successfully.',
            role_deleted_success: 'Role deleted successfully.',
            pw_reset_success: 'Password reset successfully.',
            err_cannot_delete_self: 'You cannot delete your own account.',
            err_cannot_delete_system_role: 'System roles cannot be deleted.',

            // Direct Aliases for Auth & Users Pages
            login: 'Sign In',
            login_title: 'Smart Surveillance System',
            login_subtitle: 'Please enter your credentials to access the surveillance system',
            username: 'Username',
            username_placeholder: 'Enter your username',
            password: 'Password',
            password_placeholder: 'Enter your password',
            login_btn: 'Sign In',
            logging_in: 'Authenticating...',
            invalid_credentials: 'Invalid username or password.',
            login_success: 'Signed in successfully',
            logout: 'Sign Out',
            logout_success: 'You have been signed out successfully',
            session_expired: 'Your session has expired. Please sign in again.',
            access_denied: 'You do not have permission to access this section.',
            change_password: 'Change Password',
            change_password_subtitle: 'Enter your current and new password to secure your account',
            current_password: 'Current Password',
            current_password_placeholder: 'Enter current password',
            new_password: 'New Password',
            new_password_placeholder: 'New password (min 4 characters)',
            confirm_new_password: 'Confirm New Password',
            confirm_new_password_placeholder: 'Re-enter new password',
            passwords_dont_match: 'New passwords do not match.',
            passwords_do_not_match: 'New passwords do not match.',
            password_min_length: 'Password must be at least 4 characters.',
            password_changed_success: 'Password changed successfully.',
            password_reset_success: 'User password reset successfully.',
            confirm_reset: 'Set New Password',
            saving: 'Saving...',
            show_password: 'Show password',
            hide_password: 'Hide password',
            add_user: 'Add User',
            add_role: 'New Role',
            add_user_sub: 'Specify account credentials and assigned organizational role',
            add_role_sub: 'Define authorized section permissions for this role',
            edit_user: 'Edit User',
            edit_role: 'Edit Role & Permissions',
            edit_role_permissions: 'Edit Permissions',
            role: 'Role',
            role_desc: 'Description & Scope',
            roles: 'Roles',
            status: 'Status',
            last_login: 'Last Login',
            actions: 'Actions',
            custom_permissions: 'Custom Permissions',
            custom_permissions_override: 'Custom Permissions Override',
            custom_perms_hint: 'These permissions will be granted to the user in addition to their role permissions',
            fullname: 'Full Name',
            user_active_toggle: 'User account is active',
            new_password_optional: 'New Password (Optional)',
            system_role: 'System',
            custom_role: 'Custom',
            all_permissions: 'Full system access (*)',
            no_description: 'No description',
            never_logged_in: 'Never signed in',
            reset_password: 'Reset Password',
            error_loading_data: 'Failed to load users and roles',
            err_failed_load: 'Loading error: {msg}',
            permissions: 'Permissions',
            users: 'Users',
        }
    },

    /**
     * Initialize I18n engine and load saved preference or default to 'fa'.
     */
    init() {
        const savedLang = localStorage.getItem('facetrack_lang');
        // If saved is 'en' or 'fa', use it; otherwise default strictly to 'fa'
        I18n._lang = (savedLang === 'en' || savedLang === 'fa') ? savedLang : 'fa';
        I18n.applyLanguage();
    },

    /**
     * Get active language code.
     */
    getLang() {
        return I18n._lang;
    },

    /**
     * Check if currently in RTL (Persian) mode.
     */
    isRTL() {
        return I18n._lang === 'fa';
    },

    /**
     * Switch language and update DOM/localStorage.
     */
    setLanguage(lang) {
        if (lang !== 'fa' && lang !== 'en') return;
        I18n._lang = lang;
        localStorage.setItem('facetrack_lang', lang);
        I18n.applyLanguage();

        // Notify listeners (e.g. app and active page re-renders)
        I18n._listeners.forEach(fn => {
            try { fn(lang); } catch (e) { console.error('I18n listener error:', e); }
        });
    },

    /**
     * Register a callback when language changes.
     */
    onLanguageChange(callback) {
        I18n._listeners.push(callback);
    },

    /**
     * Apply direction and document language attribute, update static elements.
     */
    applyLanguage() {
        const isRtl = I18n.isRTL();
        document.documentElement.lang = I18n._lang;
        document.documentElement.dir = isRtl ? 'rtl' : 'ltr';

        // Update static sidebar elements
        const brandName = document.querySelector('.sidebar-brand-name');
        if (brandName) brandName.textContent = I18n.t('brand_name');

        const brandSubtitle = document.querySelector('.sidebar-brand-subtitle');
        if (brandSubtitle) brandSubtitle.textContent = I18n.t('brand_subtitle');

        const navDash = document.querySelector('#nav-dashboard span:last-child');
        if (navDash) navDash.textContent = I18n.t('nav_dashboard');

        const navDuty = document.querySelector('#nav-duty span:last-child');
        if (navDuty) navDuty.textContent = I18n.t('nav_duty');

        const navZones = document.querySelector('#nav-zones span:last-child');
        if (navZones) navZones.textContent = I18n.t('nav_zones');

        const navCams = document.querySelector('#nav-cameras span:last-child');
        if (navCams) navCams.textContent = I18n.t('nav_cameras');

        const navPersons = document.querySelector('#nav-persons span:last-child');
        if (navPersons) navPersons.textContent = I18n.t('nav_persons');

        const navUsers = document.querySelector('#nav-users span:last-child');
        if (navUsers) navUsers.textContent = I18n.t('nav_users');

        const navSettings = document.querySelector('#nav-settings span:last-child');
        if (navSettings) navSettings.textContent = I18n.t('nav_settings');

        const langLabel = document.getElementById('lang-switcher-label');
        if (langLabel) langLabel.textContent = I18n.t('lang_switcher_label');

        // Update Language selector button state if present
        const toggleEn = document.getElementById('lang-btn-en');
        const toggleFa = document.getElementById('lang-btn-fa');
        if (toggleEn && toggleFa) {
            toggleEn.classList.toggle('active', I18n._lang === 'en');
            toggleFa.classList.toggle('active', I18n._lang === 'fa');
        }
    },

    /**
     * Translate a string key with optional parameters.
     * @param {string} key
     * @param {Object} params
     * @returns {string}
     */
    t(key, params = {}) {
        const lang = I18n._lang || 'fa';
        const primary = (I18n.translations && I18n.translations[lang]) || {};
        const fallbackLang = lang === 'fa' ? 'en' : 'fa';
        const secondary = (I18n.translations && I18n.translations[fallbackLang]) || {};

        let text = primary[key];
        if (text === undefined || text === null) {
            text = secondary[key];
        }
        if (text === undefined || text === null) {
            text = key;
        }

        // Replace placeholders {param}
        if (params && typeof params === 'object') {
            for (const [pKey, pVal] of Object.entries(params)) {
                text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), pVal);
            }
        }

        return text;
    },

    /**
     * Format presence last seen string for Zone cards.
     */
    formatLastSeen(p) {
        if (!p) return '';
        if (p.status === 'off_duty') {
            return I18n.t('status_off_duty');
        }
        if (p.status === 'present') {
            if (p.last_seen_sec !== null && p.last_seen_sec !== undefined) {
                const sec = Math.round(p.last_seen_sec);
                const secDisplay = I18n.isRTL() ? I18n.toPersianDigits(sec) : sec;
                return I18n.t('status_in_zone_secs', { sec: secDisplay });
            }
            return I18n.t('status_in_zone_recent');
        }
        if (p.status === 'absent') {
            if (p.minutes_absent !== null && p.minutes_absent !== undefined) {
                const mins = Math.round(p.minutes_absent);
                const minsDisplay = I18n.isRTL() ? I18n.toPersianDigits(mins) : mins;
                return I18n.t('status_missing_mins', { mins: minsDisplay });
            }
            return I18n.t('status_not_seen_yet');
        }
        return p.last_seen_str || '';
    },

    /**
     * Format timetable text with localized weekday names and Persian digits.
     */
    formatTimetableText(timetableText) {
        if (!timetableText) return '';
        let result = String(timetableText);

        if (I18n.isRTL()) {
            // Replace day tokens
            const dayMap = {
                'Sat': 'شنبه',
                'Sun': 'یکشنبه',
                'Mon': 'دوشنبه',
                'Tue': 'سه‌شنبه',
                'Wed': 'چهارشنبه',
                'Thu': 'پنج‌شنبه',
                'Fri': 'جمعه',
                'All Days': 'تمام روزها'
            };
            for (const [enDay, faDay] of Object.entries(dayMap)) {
                result = result.replace(new RegExp(enDay, 'g'), faDay);
            }
            result = I18n.toPersianDigits(result);
        }
        return result;
    },

    /**
     * Format a real-time WebSocket zone alert into a localized notification message.
     */
    formatAlertNotification(data) {
        const alertType = data.alert_type || (data.event ? data.event.alert_type : 'normal');
        const personName = data.person_name || (data.event ? data.event.person_name : I18n.t('unknown'));
        const zoneName = data.zone_name || (data.event ? data.event.zone_name : I18n.t('event_area'));
        const cameraName = data.camera_name || (data.event ? data.event.camera_name : I18n.t('event_camera'));

        if (alertType === 'absence_timeout') {
            const timeDesc = data.duration_seconds
                ? I18n.formatDuration(data.duration_seconds)
                : (data.duration_str
                    ? data.duration_str
                    : (data.message && data.message.includes('missing for')
                        ? data.message.split('missing for')[1].replace(')', '').trim()
                        : (I18n.isRTL() ? 'بیش از ۱ دقیقه' : 'over 1 min')));
            return I18n.t('notification_absence_msg', {
                person: personName,
                zone: zoneName,
                time: timeDesc
            });
        }
        if (alertType === 'unauthorized_entry') {
            return I18n.t('notification_unauthorized_msg', {
                person: personName,
                zone: zoneName,
                camera: cameraName
            });
        }
        if (alertType === 'out_of_zone') {
            return I18n.t('notification_out_of_zone_msg', {
                person: personName,
                zone: zoneName,
                camera: cameraName
            });
        }
        if (alertType === 'camera_disconnected') {
            return I18n.t('notification_camera_disconnected_msg', {
                person: personName,
                zone: zoneName,
                camera: cameraName
            });
        }
        return I18n.t('notification_zone_event', {
            person: personName,
            zone: zoneName
        });
    },

    /**
     * Format timestamp to relative human-readable format.
     */
    formatTimestamp(isoString) {
        if (!isoString) return I18n.t('unknown');
        try {
            let str = String(isoString).trim();
            if (!str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str)) {
                str += 'Z';
            }
            const date = new Date(str);
            if (isNaN(date.getTime())) return isoString;

            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);

            let relative = I18n.t('just_now');
            if (diffMins >= 1 && diffMins < 60) {
                relative = I18n.t('minutes_ago', { mins: I18n.isRTL() ? I18n.toPersianDigits(diffMins) : diffMins });
            } else if (diffMins >= 60 && diffMins < 1440) {
                const hours = Math.floor(diffMins / 60);
                relative = I18n.t('hours_ago', { hours: I18n.isRTL() ? I18n.toPersianDigits(hours) : hours });
            } else if (diffMins >= 1440) {
                const days = Math.floor(diffMins / 1440);
                relative = I18n.t('days_ago', { days: I18n.isRTL() ? I18n.toPersianDigits(days) : days });
            }

            const timeStr = date.toLocaleTimeString(I18n.isRTL() ? 'fa-IR' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            return `${timeStr} (${relative})`;
        } catch {
            return isoString;
        }
    },

    /**
     * Format full date and time (using Solar Hijri / Jalali in Persian mode).
     */
    formatFullTimestamp(isoString) {
        if (!isoString) return I18n.t('unknown');
        try {
            let str = String(isoString).trim();
            if (!str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str)) {
                str += 'Z';
            }
            const date = new Date(str);
            if (isNaN(date.getTime())) return isoString;

            if (I18n.isRTL()) {
                // Persian Jalali Calendar
                return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                }).format(date);
            } else {
                return new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                }).format(date);
            }
        } catch {
            return isoString;
        }
    },

    /**
     * Format simple date.
     */
    formatDate(isoString) {
        if (!isoString) return '—';
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return isoString;

            if (I18n.isRTL()) {
                return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                }).format(date);
            } else {
                return new Intl.DateTimeFormat('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                }).format(date);
            }
        } catch {
            return isoString;
        }
    },

    /**
     * Convert English digits to Persian digits.
     */
    toPersianDigits(str) {
        const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
        return String(str).replace(/\d/g, d => persianDigits[parseInt(d, 10)]);
    },

    /**
     * Format number according to locale.
     */
    formatNumber(num) {
        if (num === null || num === undefined) return '—';
        if (I18n.isRTL()) {
            return Number(num).toLocaleString('fa-IR');
        }
        return Number(num).toLocaleString('en-US');
    },

    /**
     * Format elapsed absence duration in localized friendly format.
     */
    formatDuration(seconds) {
        if (!seconds && seconds !== 0) return '';
        const sec = Math.max(0, parseInt(seconds, 10));
        if (sec < 60) {
            const s = I18n.isRTL() ? I18n.toPersianDigits(sec) : sec;
            return I18n.t('unit_seconds', { s });
        }
        const totalMins = Math.floor(sec / 60);
        if (totalMins < 60) {
            const m = I18n.isRTL() ? I18n.toPersianDigits(totalMins) : totalMins;
            return I18n.t('unit_minutes', { m });
        }
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const h = I18n.isRTL() ? I18n.toPersianDigits(hours) : hours;
        const m = I18n.isRTL() ? I18n.toPersianDigits(mins) : mins;
        if (mins === 0) {
            return I18n.isRTL() ? `${h} ساعت` : `${h}h`;
        }
        return I18n.t('unit_hours_minutes', { h, m });
    }
};

