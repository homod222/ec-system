const fs = require('fs');
let content = fs.readFileSync('artifacts/nursery-management/src/i18n.tsx', 'utf8');

const arAdditions = `
    'permissions.module.organization': 'المؤسسة', 'permissions.module.people': 'الأفراد', 'permissions.module.attendance': 'الحضور',
    'permissions.module.academics': 'الشؤون الأكاديمية', 'permissions.module.communications': 'التواصل', 'permissions.module.finance': 'المالية',
    'permissions.module.reports': 'التقارير', 'permissions.module.admissions': 'القبول والتسجيل', 'permissions.module.website': 'الموقع الإلكتروني',
    'permissions.module.security': 'الأمان', 'permissions.module.dashboard': 'لوحة القيادة',
    'permissions.page.branches': 'الفروع', 'permissions.page.stages': 'المراحل', 'permissions.page.settings': 'الإعدادات',
    'permissions.page.children': 'الأطفال', 'permissions.page.staff': 'فريق العمل', 'permissions.page.attendance': 'الحضور',
    'permissions.page.classrooms': 'الفصول', 'permissions.page.curriculum': 'المنهج', 'permissions.page.assessment': 'التقييم',
    'permissions.page.activities': 'الأنشطة', 'permissions.page.fees': 'الرسوم', 'permissions.page.accounting': 'المحاسبة',
    'permissions.page.reports': 'التقارير', 'permissions.page.applications': 'الطلبات', 'permissions.page.gallery': 'الألبوم',
    'permissions.page.permissions': 'الصلاحيات', 'permissions.page.dashboard': 'لوحة القيادة',
    'permissions.inheritedState': 'موروث', 'permissions.reset': 'إعادة للموروث', 'permissions.resetSection': 'إعادة كل القسم للموروث', 'permissions.resetAll': 'إعادة الكل للموروث',
`;

const enAdditions = `
    'permissions.module.organization': 'Organization', 'permissions.module.people': 'People', 'permissions.module.attendance': 'Attendance',
    'permissions.module.academics': 'Academics', 'permissions.module.communications': 'Communications', 'permissions.module.finance': 'Finance',
    'permissions.module.reports': 'Reports', 'permissions.module.admissions': 'Admissions', 'permissions.module.website': 'Website',
    'permissions.module.security': 'Security', 'permissions.module.dashboard': 'Dashboard',
    'permissions.page.branches': 'Branches', 'permissions.page.stages': 'Stages', 'permissions.page.settings': 'Settings',
    'permissions.page.children': 'Children', 'permissions.page.staff': 'Staff', 'permissions.page.attendance': 'Attendance',
    'permissions.page.classrooms': 'Classrooms', 'permissions.page.curriculum': 'Curriculum', 'permissions.page.assessment': 'Assessment',
    'permissions.page.activities': 'Activities', 'permissions.page.fees': 'Fees', 'permissions.page.accounting': 'Accounting',
    'permissions.page.reports': 'Reports', 'permissions.page.applications': 'Applications', 'permissions.page.gallery': 'Gallery',
    'permissions.page.permissions': 'Permissions', 'permissions.page.dashboard': 'Dashboard',
    'permissions.inheritedState': 'Inherited', 'permissions.reset': 'Reset to inherited', 'permissions.resetSection': 'Reset section to inherited', 'permissions.resetAll': 'Reset all to inherited',
`;

content = content.replace(/(permissions\.noSelection[^]+?)(,?\s*)('finance\.eyebrow')/, `$1,$2${arAdditions}$3`);
content = content.replace(/(permissions\.noSelection[^]+?)(,?\s*)('finance\.eyebrow')/g, function(match, p1, p2, p3, offset) {
    if (offset > content.length / 2) {
        return p1 + "," + p2 + enAdditions + p3;
    }
    return match;
});

fs.writeFileSync('artifacts/nursery-management/src/i18n.tsx', content);
