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
            nav_zones: 'منطقه‌ها و شیفت‌ها',
            nav_cameras: 'دوربین‌ها',
            nav_persons: 'هویت‌ها و چهره‌ها',
            ws_connected: 'متصل شد',
            ws_reconnecting: 'در حال اتصال مجدد...',
            ws_connecting: 'در حال برقراری ارتباط...',
            lang_switcher_label: 'زبان سیستم',

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
            loading: 'در حال بارگذاری...',
            unknown: 'ناشناس',
            unidentified: 'چهره ناشناس',
            known: 'شناسایی شده',
            known_identity: 'هویت شناخته شده',
            none: 'هیچ',
            all: 'همه',
            details: 'جزئیات',
            search: 'جستجو',

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

            // Time Relative
            just_now: 'هم‌اکنون',
            minutes_ago: '{mins} دقیقه پیش',
            hours_ago: '{hours} ساعت پیش',
            days_ago: '{days} روز پیش',
        },

        en: {
            // Brand & Navigation
            brand_name: 'FaceTrack',
            brand_subtitle: 'Detection System',
            nav_dashboard: 'Dashboard',
            nav_zones: 'Zones & Shifts',
            nav_cameras: 'Cameras',
            nav_persons: 'Identities',
            ws_connected: 'Connected',
            ws_reconnecting: 'Reconnecting...',
            ws_connecting: 'Connecting...',
            lang_switcher_label: 'Language',

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
            loading: 'Loading...',
            unknown: 'Unknown',
            unidentified: 'Unidentified Face',
            known: 'Known',
            known_identity: 'Known Identity',
            none: 'None',
            all: 'All',
            details: 'Details',
            search: 'Search',

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

            // Time Relative
            just_now: 'Just now',
            minutes_ago: '{mins}m ago',
            hours_ago: '{hours}h ago',
            days_ago: '{days}d ago',
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

        const navZones = document.querySelector('#nav-zones span:last-child');
        if (navZones) navZones.textContent = I18n.t('nav_zones');

        const navCams = document.querySelector('#nav-cameras span:last-child');
        if (navCams) navCams.textContent = I18n.t('nav_cameras');

        const navPersons = document.querySelector('#nav-persons span:last-child');
        if (navPersons) navPersons.textContent = I18n.t('nav_persons');

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
        const dict = I18n.translations[I18n._lang] || I18n.translations.fa;
        let text = dict[key] || (I18n.translations.en ? I18n.translations.en[key] : key) || key;

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
            const timeDesc = data.message && data.message.includes('missing for')
                ? data.message.split('missing for')[1].replace(')', '').trim()
                : (I18n.isRTL() ? 'بیش از ۱ دقیقه' : 'over 1 min');
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
    }
};

