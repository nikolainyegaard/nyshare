<template lang="pug">
  .admin-app
    .topbar
      h1 NyShare - Admin
      .topbar-actions
        a.btn.btn-primary(@click='refreshData()', title='Refresh')
          icon(name="fa-sync-alt")
          |  Refresh
        form(method='post', action='/admin/logout', style='display:contents')
          button.btn.btn-primary(type='submit') Log out

    .alert.alert-danger(v-show="error")
      strong
        icon.fa-fw(name="fa-exclamation-triangle")
        |  {{ error }}

    div
      table.table.table-hover
        thead
          tr
            th SID
            th Created
            th Downloaded
            th Expire
            th Size
        template(v-for="(bucket, sid) in db")
          tbody(:class="{expanded: expand===sid}")
            tr.bucket(@click="expandView(sid)")
              td
                | {{ sid }}
                icon.pull-right(name="fa-key", v-if="sum[sid].password", title="Password protected")
              td {{ formatDate(sum[sid].created) }}
              td
                template(v-if="sum[sid].lastDownload") {{ formatDate(sum[sid].lastDownload) }}
                template(v-else) -
              td
                template(v-if="typeof sum[sid].firstExpire === 'number'") {{ formatDate(sum[sid].firstExpire) }}
                template(v-else)  {{ sum[sid].firstExpire }}
              td.text-right {{ humanFileSize(sum[sid].size) }}
          tbody.expanded(v-if="expand === sid")
            template(v-for="file in bucket")
              tr.file
                td {{ file.metadata.name }}
                td {{ formatDate(+file.metadata.createdAt) }}
                td
                  template(v-if="file.metadata.lastDownload") {{ formatDate(+file.metadata.lastDownload) }}
                  template(v-else) -
                td
                  template(v-if="typeof file.expireDate === 'number'") {{ formatDate(file.expireDate) }}
                  template(v-else) {{ file.expireDate }}
                td.text-right {{ humanFileSize(file.size) }}
        tfoot
          tr
            td(colspan="3")
            td.text-right(colspan="2") Sum: {{ humanFileSize(sizeSum) }}

</template>


<script>
  import { humanFileSize } from './common/util';

  export default {
    name: 'app',

    data () {
      return {
        db: {},
        sum: {},
        error: '',
        expand: false,
        sizeSum: 0
      }
    },

    mounted() {
      this.refreshData();
    },

    methods: {
      expandView(sid) {
        if(this.expand === sid) return this.expand = false;
        this.expand = sid;
      },

      refreshData() {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'admin/data.json');
        xhr.onload = () => {
          if(xhr.status === 200) {
            try {
              this.db = JSON.parse(xhr.responseText);
              this.error = '';
              this.expandDb();
            }
            catch(e) {
              this.error = e.toString();
            }
          } else if(xhr.status === 401) {
            window.location.href = '/admin/login';
          } else {
            this.error = `${xhr.status} ${xhr.statusText}: ${xhr.responseText}`;
          }
        };
        xhr.send();
      },

      expandDb() {
        this.sizeSum = 0;
        this.sum = {};
        Object.keys(this.db).forEach(sid => {
          const bucketSum = {
            firstExpire: Number.MAX_SAFE_INTEGER,
            lastDownload: 0,
            created: Number.MAX_SAFE_INTEGER,
            password: false,
            size: 0
          };
          this.db[sid].forEach(file => {
            bucketSum.size += file.size;
            if(file.metadata._password) {
              bucketSum.password = true;
            }
            if(+file.metadata.createdAt < bucketSum.created) {
              bucketSum.created = +file.metadata.createdAt;
            }
            if(file.metadata.lastDownload && +file.metadata.lastDownload > bucketSum.lastDownload) {
              bucketSum.lastDownload = +file.metadata.lastDownload;
            }
            if(file.metadata.retention === 'one-time') {
              bucketSum.firstExpire = 'one-time';
              file.expireDate = file.metadata.retention;
            }
            else {
              file.expireDate = +file.metadata.createdAt + (+file.metadata.retention * 1000);
              if(bucketSum.firstExpire > file.expireDate) bucketSum.firstExpire = file.expireDate;
            }
          });
          this.sizeSum += bucketSum.size;
          this.sum[sid] = bucketSum;
        });
      },

      humanFileSize,

      formatDate(val) {
        if(!val) return val;
        let dt = val instanceof Date ? val : new Date(val);
        if(isNaN(dt.getTime())) return val;
        const f = d => d < 10 ? '0' + d : d;
        return dt.getFullYear() + '-' + f(dt.getMonth() + 1) + '-' + f(dt.getDate())
          + ' ' + f(dt.getHours()) + ':' + f(dt.getMinutes());
      },
    },
  }
</script>

