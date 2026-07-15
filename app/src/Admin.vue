<template lang="pug">
  .admin-app
    .topbar
      h1 NyShare
        span.topbar-tag Admin
      .topbar-actions
        button.btn.btn-primary(@click='refresh()', :disabled='loading', title='Refresh')
          icon.fa-fw(name='fa-sync-alt', :animation="loading ? 'spin' : undefined")
          |  Refresh
        form(method='post', action='admin/logout', style='display:contents')
          button.btn(type='submit') Log out

    .alert.alert-danger(v-show='error')
      strong
        icon.fa-fw(name='fa-exclamation-triangle')
        |  {{ error }}

    .stat-grid
      .stat-card
        .stat-value {{ shares.length }}
        .stat-label Active shares
      .stat-card
        .stat-value {{ fileCount }}
        .stat-label Files
      .stat-card
        .stat-value {{ humanFileSize(totalSize) }}
        .stat-label Storage used
      .stat-card
        .stat-value {{ totalDownloads }}
        .stat-label Downloads served

    .panel
      .panel-heading
        strong Shares
        input.form-control.admin-search(
          type='search',
          placeholder='Filter by share ID, file name or IP',
          v-model='query'
        )
      p.empty-state(v-if='!filteredShares.length') {{ shares.length ? 'No shares match the filter' : 'No active shares' }}
      table.table.shares-table(v-else)
        thead
          tr
            th Share
            th Created
            th Expires
            th.text-right Files
            th.text-right Size
            th.text-right Downloads
            th.text-right Actions
        tbody(
          v-for='share in filteredShares',
          :key='share.sid',
          :class="{ expanded: expanded === share.sid }"
        )
          tr.share-row(@click='toggle(share.sid)')
            td
              strong.share-sid {{ share.sid }}
              span.badge.badge-dim(v-if='share.password', title='Password protected')
                icon(name='fa-key')
              span.badge.badge-info(v-if='share.partial') uploading
            td(:title='formatDate(share.created)') {{ relTime(share.created) }}
            td
              span.badge.badge-warn(v-if='share.oneTime') one-time
              template(v-else) {{ relTime(share.expires) }}
            td.text-right {{ share.files.length }}
            td.text-right {{ humanFileSize(share.size) }}
            td.text-right {{ share.downloads }}
            td.text-right.actions
              a.btn.btn-sm(:href='share.sid', target='_blank', title='Open download page', @click.stop)
                icon(name='fa-external-link-alt')
              clipboard.btn.btn-sm(:value='shareLink(share.sid)', title='Copy share link')
                template(v-slot:default='{ state }')
                  icon(:name="state === 'copied' ? 'fa-check' : 'fa-copy'")
              button.btn.btn-sm.btn-danger(@click.stop='deleteShare(share)', title='Delete share')
                icon(name='fa-trash')
          template(v-if='expanded === share.sid')
            tr.file-row(v-for='file in share.files', :key='file.key')
              td(colspan='3')
                span.file-name {{ file.metadata.name }}
                small.text-muted(v-if='file.metadata.comment')  {{ file.metadata.comment }}
                span.ip-chip(v-if='file.metadata.clientIp', title='Uploaded from') {{ file.metadata.clientIp }}
              td.text-right
                span.badge.badge-info(v-if='file.isPartial') uploading
              td.text-right {{ humanFileSize(file.size) }}
              td.text-right(:title="file.metadata.lastDownload ? 'Last download: ' + formatDate(+file.metadata.lastDownload) : 'Never downloaded'")
                | {{ +file.metadata.downloads || 0 }}
              td.text-right.actions
                a.btn.btn-sm(
                  :href='fileLink(share.sid, file.key)',
                  :download='file.metadata.name',
                  title='Download file',
                  @click='confirmOneTimeDownload($event, file)'
                )
                  icon(name='fa-download')
                button.btn.btn-sm.btn-danger(@click='deleteFile(share, file)', title='Delete file')
                  icon(name='fa-trash')

    .panel
      .panel-heading
        strong Recent activity
        small.text-muted refreshes every 30s
      p.empty-state(v-if='!events.length') No activity yet
      ul.activity-feed(v-else)
        li(v-for='(ev, i) in events', :key='ev.time + "-" + i')
          span.activity-icon(:class='"activity-" + ev.type')
            icon(:name='eventIcon(ev.type)')
          span.activity-desc
            | {{ eventText(ev) }}
            a.activity-sid(v-if='db[ev.sid]', :href='ev.sid', target='_blank') {{ ev.sid }}
            span.activity-sid(v-else) {{ ev.sid }}
          span.ip-chip(v-if='ev.ip') {{ ev.ip }}
          span.activity-time(:title='formatDate(ev.time)') {{ relTime(ev.time) }}
</template>


<script>
  import Clipboard from './common/Clipboard.vue';
  import { humanFileSize } from './common/util';

  const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  function relTime(ts) {
    const diff = ts - Date.now();
    for (const [unit, ms] of [['day', 864e5], ['hour', 36e5], ['minute', 6e4]]) {
      if (Math.abs(diff) >= ms) return RTF.format(Math.round(diff / ms), unit);
    }
    return RTF.format(Math.round(diff / 1000), 'second');
  }

  const EVENT_VERBS = {
    upload: 'uploaded to',
    download: 'downloaded from',
    archive: 'downloaded as archive from',
    expired: 'expired from',
    deleted: 'deleted from',
  };

  const EVENT_ICONS = {
    upload: 'fa-upload',
    download: 'fa-download',
    archive: 'fa-download',
    expired: 'fa-history',
    deleted: 'fa-trash',
  };

  export default {
    name: 'Admin',
    components: { Clipboard },

    data() {
      return {
        db: {},
        events: [],
        error: '',
        loading: false,
        query: '',
        expanded: null,
        baseURI: document.head.getElementsByTagName('base')[0].href,
      };
    },

    computed: {
      shares() {
        return Object.entries(this.db).map(([sid, files]) => ({
          sid,
          files,
          size: files.reduce((s, f) => s + f.size, 0),
          downloads: files.reduce((s, f) => s + (+f.metadata.downloads || 0), 0),
          created: Math.min(...files.map(f => +f.metadata.createdAt)),
          oneTime: files.some(f => f.metadata.retention === 'one-time'),
          expires: files.some(f => f.metadata.retention === 'one-time') ? null
            : Math.min(...files.map(f => +f.metadata.createdAt + (+f.metadata.retention * 1000))),
          password: files.some(f => f.metadata._password),
          partial: files.some(f => f.isPartial),
        })).sort((a, b) => b.created - a.created);
      },

      filteredShares() {
        const q = this.query.trim().toLowerCase();
        if (!q) return this.shares;
        return this.shares.filter(s =>
          s.sid.toLowerCase().includes(q)
          || s.files.some(f =>
            (f.metadata.name || '').toLowerCase().includes(q)
            || (f.metadata.clientIp || '').includes(q)));
      },

      fileCount() { return this.shares.reduce((s, x) => s + x.files.length, 0); },
      totalSize() { return this.shares.reduce((s, x) => s + x.size, 0); },
      totalDownloads() { return this.shares.reduce((s, x) => s + x.downloads, 0); },
    },

    mounted() {
      this.refresh();
      this._timer = setInterval(() => this.refresh(true), 30000);
    },

    beforeUnmount() {
      clearInterval(this._timer);
    },

    methods: {
      humanFileSize,
      relTime,

      toggle(sid) {
        this.expanded = this.expanded === sid ? null : sid;
      },

      shareLink(sid) {
        return this.baseURI + sid;
      },

      fileLink(sid, key) {
        return this.baseURI + 'files/' + sid + '++' + key;
      },

      async refresh(silent) {
        if (!silent) this.loading = true;
        try {
          const [dataRes, actRes] = await Promise.all([
            fetch('admin/data.json'),
            fetch('admin/activity.json'),
          ]);
          if (dataRes.status === 401 || actRes.status === 401) {
            window.location.href = 'admin/login';
            return;
          }
          if (!dataRes.ok || !actRes.ok) {
            throw new Error(`HTTP ${dataRes.ok ? actRes.status : dataRes.status}`);
          }
          this.db = await dataRes.json();
          this.events = (await actRes.json()).events;
          this.error = '';
        } catch (e) {
          this.error = 'Failed to load admin data: ' + e.message;
        }
        this.loading = false;
      },

      async deleteShare(share) {
        const files = share.files.length === 1 ? '1 file' : `${share.files.length} files`;
        if (!confirm(`Delete share ${share.sid} (${files})? This cannot be undone.`)) return;
        await this.doDelete(`admin/files/${share.sid}`);
      },

      async deleteFile(share, file) {
        if (!confirm(`Delete ${file.metadata.name} from share ${share.sid}? This cannot be undone.`)) return;
        await this.doDelete(`admin/files/${share.sid}/${file.key}`);
      },

      async doDelete(url) {
        try {
          const res = await fetch(url, { method: 'DELETE' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await this.refresh(true);
        } catch (e) {
          this.error = 'Delete failed: ' + e.message;
        }
      },

      confirmOneTimeDownload(ev, file) {
        if (file.metadata.retention === 'one-time'
          && !confirm('This is a one-time file. Downloading it here consumes the share link. Continue?')) {
          ev.preventDefault();
        }
      },

      eventText(ev) {
        const subject = ev.file || (ev.files ? `${ev.files} files` : 'share');
        return `${subject} ${EVENT_VERBS[ev.type] || ev.type} `;
      },

      eventIcon(type) {
        return EVENT_ICONS[type] || 'fa-history';
      },

      formatDate(val) {
        if (!val) return val;
        const dt = val instanceof Date ? val : new Date(val);
        if (isNaN(dt.getTime())) return val;
        const f = d => d < 10 ? '0' + d : d;
        return dt.getFullYear() + '-' + f(dt.getMonth() + 1) + '-' + f(dt.getDate())
          + ' ' + f(dt.getHours()) + ':' + f(dt.getMinutes());
      },
    },
  };
</script>
